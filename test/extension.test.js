/**
 * Tests the VS Code extension host logic against a mocked `vscode` API
 * and a fake workbench bundle. Run: node test/extension.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; failures.push({ name, error: e }); console.log('  \u2717 ' + name + ' — ' + e.message); }
}

function makeFakeVSCode(appRoot, settings) {
  const state = {
    settings: Object.assign({ enabled: true, mode: 'smart', inputs: true, monacoChatInput: true, extraCSS: '', containerSelector: '', excludeSelector: '' }, settings || {}),
    statusTexts: [],
    messages: [],
    commands: {},
    reloads: 0
  };

  const disposable = { dispose() {} };

  const config = {
    get(key, def) { return key in state.settings ? state.settings[key] : def; },
    async update(key, value) { state.settings[key] = value; }
  };

  const vscode = {
    version: '1.99.0',
    env: { appRoot, openExternal() {} },
    Uri: { parse: (s) => s },
    StatusBarAlignment: { Left: 1, Right: 2 },
    window: {
      createStatusBarItem() {
        return {
          text: '', tooltip: '', command: '',
          show() {},
          dispose() {}
        };
      },
      showInformationMessage(msg) { state.messages.push({ type: 'info', msg }); return Promise.resolve(undefined); },
      showWarningMessage(msg) { state.messages.push({ type: 'warn', msg }); return Promise.resolve(undefined); },
      showErrorMessage(msg) { state.messages.push({ type: 'error', msg }); return Promise.resolve(undefined); },
      setStatusBarMessage() {}
    },
    workspace: {
      getConfiguration() { return config; },
      onDidChangeConfiguration() { return disposable; }
    },
    commands: {
      registerCommand(id, fn) { state.commands[id] = fn; return disposable; },
      executeCommand(id) {
        if (id === 'workbench.action.reloadWindow') state.reloads++;
        return Promise.resolve();
      }
    }
  };
  return { vscode, state };
}

function makeFakeAppRoot() {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-vscode-'));
  const wbDir = path.join(appRoot, 'out', 'vs', 'workbench');
  fs.mkdirSync(wbDir, { recursive: true });
  fs.writeFileSync(path.join(appRoot, 'product.json'), JSON.stringify({ nameShort: 'FakeCode', version: '1.99.0' }));
  const original = '/* fake workbench bundle */\nconsole.log("workbench");\n';
  fs.writeFileSync(path.join(wbDir, 'workbench.desktop.main.js'), original);
  return { appRoot, wbFile: path.join(wbDir, 'workbench.desktop.main.js'), original };
}

function loadExtension(vscodeMock) {
  const notFound = new Error('not found');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscodeMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../vscode-extension/extension.js')];
    return require('../vscode-extension/extension.js');
  } finally {
    Module._load = originalLoad;
  }
}

function makeContext(state) {
  return {
    subscriptions: [],
    globalState: {
      _s: {},
      get(k, d) { return k in this._s ? this._s[k] : d; },
      async update(k, v) { this._s[k] = v; }
    }
  };
}

(async function main() {
  console.log('\nVS Code extension tests (mocked host)\n');

  await test('activation patches the workbench bundle with backup', async () => {
    const { appRoot, wbFile, original } = makeFakeAppRoot();
    const { vscode } = makeFakeVSCode(appRoot);
    const ext = loadExtension(vscode);
    const ctx = makeContext();
    ext.activate(ctx);

    const content = fs.readFileSync(wbFile, 'utf8');
    assert.ok(content.includes('/*rtl-universal-start*/'));
    assert.ok(content.includes('/*rtl-universal-end*/'));
    assert.ok(content.includes('CyrusAsha_UniversalRTL-1.0.0'), 'engine must be embedded');
    assert.ok(content.startsWith(original), 'original bundle must be preserved');
    assert.ok(fs.existsSync(wbFile + '.rtl-universal.bak'));
    assert.strictEqual(fs.readFileSync(wbFile + '.rtl-universal.bak', 'utf8'), original);
    ext.deactivate();
  });

  await test('re-activation does not duplicate the block', async () => {
    const { appRoot, wbFile } = makeFakeAppRoot();
    const { vscode } = makeFakeVSCode(appRoot);
    let ext = loadExtension(vscode);
    ext.activate(makeContext());
    ext.deactivate();

    ext = loadExtension(vscode);
    ext.activate(makeContext());
    const content = fs.readFileSync(wbFile, 'utf8');
    const count = (content.match(/rtl-universal-start/g) || []).length;
    assert.strictEqual(count, 1);
    ext.deactivate();
  });

  await test('settings changes rewrite the block (mode reflected)', async () => {
    const { appRoot, wbFile } = makeFakeAppRoot();
    const { vscode, state } = makeFakeVSCode(appRoot);
    const ext = loadExtension(vscode);
    ext.activate(makeContext());

    // Simulate "set mode rtl" command
    await state.commands['rtlUniversal.setModeRtl']();
    const content = fs.readFileSync(wbFile, 'utf8');
    assert.ok(content.includes('"mode":"rtl"'), 'config must be embedded in the block');
    ext.deactivate();
  });

  await test('disable command restores the pristine bundle', async () => {
    const { appRoot, wbFile, original } = makeFakeAppRoot();
    const { vscode, state } = makeFakeVSCode(appRoot);
    const ext = loadExtension(vscode);
    ext.activate(makeContext());
    assert.ok(fs.readFileSync(wbFile, 'utf8').includes('rtl-universal-start'));

    await state.commands['rtlUniversal.disable']();
    assert.strictEqual(fs.readFileSync(wbFile, 'utf8'), original);
    assert.ok(!fs.existsSync(wbFile + '.rtl-universal.bak'));
    ext.deactivate();
  });

  await test('surgical removal works when backup was deleted', async () => {
    const { appRoot, wbFile, original } = makeFakeAppRoot();
    const { vscode, state } = makeFakeVSCode(appRoot);
    const ext = loadExtension(vscode);
    ext.activate(makeContext());
    fs.unlinkSync(wbFile + '.rtl-universal.bak');
    fs.unlinkSync(wbFile + '.rtl-universal.bak.json');

    await state.commands['rtlUniversal.disable']();
    const content = fs.readFileSync(wbFile, 'utf8');
    assert.ok(!content.includes('rtl-universal-start'));
    assert.ok(content.trim().startsWith('/* fake workbench bundle */'));
    assert.ok(content.includes('console.log("workbench")'));
    ext.deactivate();
  });

  await test('unsupported IDE (no workbench file) fails gracefully without crashing', async () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-unsupported-'));
    const { vscode, state } = makeFakeVSCode(appRoot);
    const ext = loadExtension(vscode);
    ext.activate(makeContext());
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(state.messages.some((m) => m.type === 'error' && m.msg.includes('Workbench')));
    ext.deactivate();
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    failures.forEach((f) => console.error('FAILED: ' + f.name + '\n' + f.error.stack + '\n'));
    process.exit(1);
  }
})();
