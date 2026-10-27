/**
 * Runtime tests for the injected Electron hook.
 * Run: node test/hook-runtime.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { JSDOM } = require('jsdom');
const patcher = require('../src/patcher/patch-electron');

function makeContents() {
  const contents = new EventEmitter();
  contents.id = 12;
  contents.getType = () => 'window';
  contents.isDestroyed = () => false;
  return contents;
}

function loadHook({ contents, diagnostics, logPath }) {
  const app = new EventEmitter();
  app.whenReady = () => Promise.resolve();
  app.getVersion = () => '0.0.192';
  const electron = {
    app,
    webContents: { getAllWebContents: () => [contents] }
  };
  const env = {
    RTL_UNIVERSAL_DIAGNOSTICS: diagnostics ? '1' : '0',
    RTL_UNIVERSAL_DIAGNOSTICS_PATH: logPath,
    RTL_UNIVERSAL_TRIGGER_INTERVAL: '20',
    TEMP: path.dirname(logPath || os.tmpdir()),
    TMP: path.dirname(logPath || os.tmpdir())
  };
  const mockProcess = { env, pid: 4321, versions: { electron: '34.0.0' }, cwd: () => os.tmpdir() };
  const context = {
    require(name) {
      if (name === 'electron') return electron;
      return require(name);
    },
    process: mockProcess,
    __dirname: path.dirname(logPath || os.tmpdir()),
    console,
    Promise,
    Buffer,
    setTimeout,
    clearTimeout,
    // Fake interval: the test drives the trigger poll itself, so no real timer
    // can keep the process alive after the assertions.
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {}
  };
  const intervals = [];
  vm.runInNewContext(patcher.HOOK_SOURCE, context, { filename: patcher.HOOK_FILE });
  return { app, electron, intervals };
}

const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

(async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-hook-test-'));
  let dom;
  try {
    fs.copyFileSync(path.join(__dirname, '..', 'src', 'engine', 'rtl-engine.js'),
      path.join(temp, patcher.ENGINE_FILE));
    fs.writeFileSync(path.join(temp, patcher.CONFIG_FILE), JSON.stringify({ mode: 'smart' }), 'utf8');
    fs.writeFileSync(path.join(temp, patcher.CSS_FILE), '', 'utf8');

    const logPath = path.join(temp, 'runtime.jsonl');
    dom = new JSDOM('<!doctype html><html><head></head><body><div class="prose">سلام دنیا</div></body></html>', {
      runScripts: 'outside-only'
    });
    const contents = makeContents();
    let mainCode = '';
    let isolatedArgs = null;
    contents.executeJavaScript = (code) => {
      mainCode = code;
      return Promise.reject(Object.assign(
        new Error('Refused by Content Security Policy: unsafe-eval'),
        { name: 'EvalError' }
      ));
    };
    contents.executeJavaScriptInIsolatedWorld = (worldId, scripts, userGesture) => {
      isolatedArgs = { worldId, scripts, userGesture };
      const result = dom.window.eval(scripts[0].code);
      return Promise.resolve(result);
    };

    const hook = loadHook({ contents, diagnostics: true, logPath });
    assert.ok(hook.intervals.length >= 1, 'the hook must poll for a report request');
    await wait(); // app.whenReady -> attach existing contents
    contents.emit('dom-ready');
    await wait(); // main-world rejection -> isolated-world fallback
    if (dom.window.document.readyState === 'loading') {
      dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
    }
    await wait(30);

    assert.ok(mainCode.includes('window.__RTL_UNIVERSAL_CONFIG__'), 'main-world payload should contain RTL config');
    assert.ok(isolatedArgs, 'CSP rejection should trigger isolated-world fallback');
    assert.strictEqual(isolatedArgs.worldId, 98765);
    assert.strictEqual(isolatedArgs.scripts.length, 1);
    assert.strictEqual(isolatedArgs.userGesture, true);
    assert.doesNotThrow(() => new vm.Script(isolatedArgs.scripts[0].code), 'injected page code should parse');

    const records = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(records.some((r) => r.event === 'hook-loaded'));
    assert.ok(records.some((r) => r.event === 'renderer-inject-error' && r.details.error.category === 'csp'));
    const isolated = records.find((r) => r.event === 'isolated-world-result');
    assert.ok(isolated, 'isolated-world result should be logged when diagnostics are explicitly enabled');
    assert.strictEqual(isolated.details.status.loaded, true);
    assert.strictEqual(isolated.details.status.proseCount, 1);
    assert.strictEqual(dom.window.document.querySelector('.prose').getAttribute('data-rtl-dir'), 'rtl',
      'the actual RTL engine should mark a Persian .prose block in the fallback world');
    assert.ok(!/secret message|سلام|conversation text/i.test(fs.readFileSync(logPath, 'utf8')),
      'runtime diagnostics must not include message contents');

    console.log('  ✓ CSP rejection falls back to an isolated world and records metadata only');

    /* --- Live report: a trigger file asks the *running* app, no restart --- */
    contents.executeJavaScript = () => Promise.resolve({
      loaded: true,
      version: '1.0.0',
      mode: 'smart',
      proseCount: 2,
      rtlCount: 2,
      containers: { total: 2, rtl: 2 },
      marked: { rtl: 2, ltr: 0 },
      stats: { processed: 12, rtl: 5, ltr: 1, skipped: 2, errors: 0, sweeps: 3 },
      samples: [{ tier1: true, decided: 'rtl', textLength: 42, classes: 'prose' }]
    });
    const trigger = path.join(temp, 'CyrusAsha_UniversalRTL-dump-request.json');
    fs.writeFileSync(trigger, 'report', 'utf8');
    hook.intervals.forEach((poll) => poll());
    await wait(60);

    assert.ok(!fs.existsSync(trigger), 'the trigger file must be consumed and removed');
    const reportLines = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const report = reportLines.find((r) => r.event === 'renderer-report');
    assert.ok(report, 'a live report must be written when the trigger file appears: ' + JSON.stringify(reportLines.map((r) => r.event)));
    assert.strictEqual(report.details.status.loaded, true);
    assert.strictEqual(report.details.status.proseCount, 2);
    assert.strictEqual(report.details.status.containers.total, 2);
    assert.strictEqual(report.details.status.stats.sweeps, 3);
    assert.ok(reportLines.some((r) => r.event === 'dump-finished'), 'the dump must be closed out');
    assert.ok(!/سلام|محرمانه|confidential message/i.test(fs.readFileSync(logPath, 'utf8')),
      'live reports must stay text-free');

    console.log('  ✓ trigger file yields a live report from the running app (text-free)');
  } finally {
    if (dom) dom.window.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})();
