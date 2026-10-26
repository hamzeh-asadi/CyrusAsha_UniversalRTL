/**
 * End-to-end test of the Electron patcher on a fake Electron app.
 * Run: node test/patcher.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const official = require('@electron/asar');
const patcher = require('../src/patcher/patch-electron');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; failures.push({ name, error: e }); console.log('  \u2717 ' + name + ' — ' + e.message); }
}

/* ============================================================================
 * این تست چطور کار می‌کند؟
 * ----------------------------------------------------------------------------
 * ۱. یک «اپ Electron جعلی» می‌سازیم: یک پوشه با package.json و main.js
 *    که require('electron') دارد.
 * ۲. با کتابخانه‌ی رسمی @electron/asar آن را به app.asar تبدیل می‌کنیم.
 * ۳. پچر خودمان را روی آن اجرا می‌کنیم و نتیجه را باز می‌کنیم.
 * ۴. بررسی می‌کنیم فایل main سالم مانده، هُک اضافه شده و بکاپ درست است.
 * ========================================================================== */
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/* @electron/asar resolves createPackage() before Windows has released its write
 * handle. Patching immediately then fails with EPERM (rename over an open file),
 * so give the OS a moment before the patcher swaps app.asar. */
async function pack(src, dest) {
  await official.createPackage(src, dest);
  if (process.platform === 'win32') await new Promise((resolve) => setTimeout(resolve, 250));
}

/* ساخت اپ جعلی. مهم: preload.js نباید هرگز پچ شود و assets دست‌نخورده بماند. */
async function makeFakeApp(options = {}) {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-app-'));
  const resources = path.join(appRoot, 'resources');
  fs.mkdirSync(resources, { recursive: true });
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-src-'));
  const mainName = options.typeModule ? 'main.cjs' : 'main.js';
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({
    name: 'fake-agent', productName: 'Fake Agent', version: '9.9.9', main: mainName,
    ...(options.typeModule ? { type: 'module' } : {})
  }, null, 2));
  fs.writeFileSync(path.join(src, mainName),
    "'use strict';\nconst { app, BrowserWindow } = require('electron');\n" +
    'app.whenReady().then(() => { new BrowserWindow({ width: 800 }); });\n');
  fs.writeFileSync(path.join(src, 'renderer.js'), "console.log('renderer');\n");
  fs.writeFileSync(path.join(src, 'preload.js'), "const { contextBridge } = require('electron');\ncontextBridge.exposeInMainWorld('x', {});\n");
  fs.mkdirSync(path.join(src, 'assets'));
  fs.writeFileSync(path.join(src, 'assets', 'style.css'), 'body{color:red}');
  await pack(src, path.join(resources, 'app.asar'));
  return { appRoot, resources, src };
}

(async function main() {
  console.log('\nElectron patcher tests\n');

  await test('patch injects hook + runtime files without breaking anything', async () => {
    const { appRoot, resources } = await makeFakeApp();
    const asarPath = path.join(resources, 'app.asar');
    const before = sha(asarPath);

    const res = patcher.patchApp(appRoot, { mode: 'smart' });
    assert.ok(res.ok, res.error);
    assert.strictEqual(res.plan.app, 'Fake Agent');
    assert.ok(res.plan.scriptFiles.includes('main.js'));
    assert.ok(!res.plan.scriptFiles.includes('preload.js'), 'preload must not be hooked');

    // Runtime files present. The hook must be .cjs so an app with
    // "type": "module" does not hand this CommonJS file to Node's ESM loader.
    assert.strictEqual(patcher.HOOK_FILE, 'rtl-universal.cjs');
    assert.ok(official.extractFile(asarPath, 'rtl-universal.cjs').toString().includes('web-contents-created'));
    assert.ok(official.extractFile(asarPath, 'rtl-universal.cjs').toString().includes('executeJavaScriptInIsolatedWorld'));
    assert.ok(official.extractFile(asarPath, 'rtl-universal-engine.js').toString().includes('CyrusAsha_UniversalRTL-1.0.0'));
    assert.ok(patcher.isPatchCurrent(asarPath), 'new hook and engine must be recognized as current');
    const cfg = JSON.parse(official.extractFile(asarPath, 'rtl-universal.config.json').toString());
    assert.strictEqual(cfg.mode, 'smart');

    // Hook line in main.js after "use strict"
    const main = official.extractFile(asarPath, 'main.js').toString();
    assert.ok(main.startsWith("'use strict';\n/*rtl-universal-hook*/"), 'hook must come after use strict');
    assert.ok(main.includes("require('electron')"), 'original main must be preserved');

    // Untouched files
    assert.strictEqual(official.extractFile(asarPath, 'assets/style.css').toString(), 'body{color:red}');
    assert.strictEqual(official.extractFile(asarPath, 'preload.js').toString().startsWith('/*rtl'), false);

    // Backup is pristine
    assert.ok(fs.existsSync(asarPath + '.rtl-backup'));
    assert.strictEqual(sha(asarPath + '.rtl-backup'), before);
  });

  await test('patches a "type": "module" app with a .cjs hook', async () => {
    const { appRoot, resources } = await makeFakeApp({ typeModule: true });
    const asarPath = path.join(resources, 'app.asar');
    const res = patcher.patchApp(appRoot, {});
    assert.ok(res.ok, res.error);
    assert.ok(res.plan.scriptFiles.includes('main.cjs'));

    const main = official.extractFile(asarPath, 'main.cjs').toString();
    assert.ok(main.includes('rtl-universal.cjs'), 'hook snippet must reference the .cjs file');
    assert.ok(main.indexOf('rtl-universal.cjs') < main.indexOf('rtl-universal.js'),
      '.cjs must be tried before the legacy .js name');
    assert.ok(official.extractFile(asarPath, patcher.HOOK_FILE).toString().includes("require('electron')"));
    assert.strictEqual(patcher.isPatchCurrent(asarPath), true);
  });

  await test('a legacy rtl-universal.js is never chosen as the main script and is removed on re-patch', async () => {
    const { appRoot, resources, src } = await makeFakeApp({ typeModule: true });
    // Simulate an app that still carries the old hook file from a previous patch.
    fs.writeFileSync(path.join(src, 'rtl-universal.js'),
      "'use strict';\nconst { app } = require('electron');\napp.whenReady();\n");
    const asarPath = path.join(resources, 'app.asar');
    await pack(src, asarPath);

    const res = patcher.patchApp(appRoot, {});
    assert.ok(res.ok, res.error);
    assert.ok(!res.plan.scriptFiles.includes('rtl-universal.js'), 'legacy hook must not be treated as a main script');
    assert.ok(res.plan.scriptFiles.includes('main.cjs'));
    const entries = official.listPackage(asarPath).map((p) => p.replace(/^[\\/]+/, '').replace(/\\/g, '/'));
    assert.ok(entries.includes('rtl-universal.cjs'), 'new hook must exist');
    assert.ok(!entries.includes('rtl-universal.js'), 'legacy hook must be removed');
  });

  await test('isPatched detects patched/unpatched state', async () => {
    const { appRoot, resources } = await makeFakeApp();
    const asarPath = path.join(resources, 'app.asar');
    assert.strictEqual(patcher.isPatched(asarPath), false);
    assert.ok(patcher.patchApp(appRoot, {}).ok);
    assert.strictEqual(patcher.isPatched(asarPath), true);
  });

  await test('distinguishes stale embedded engine or hook from the current build', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-version-'));
    const staleSrc = path.join(root, 'stale');
    const currentSrc = path.join(root, 'current');
    fs.mkdirSync(staleSrc);
    fs.mkdirSync(currentSrc);
    fs.writeFileSync(path.join(staleSrc, patcher.ENGINE_FILE), 'old engine bytes');
    fs.writeFileSync(path.join(staleSrc, patcher.HOOK_FILE), 'old hook bytes');
    fs.copyFileSync(path.join(__dirname, '..', 'src', 'engine', 'rtl-engine.js'), path.join(currentSrc, patcher.ENGINE_FILE));
    fs.writeFileSync(path.join(currentSrc, patcher.HOOK_FILE), patcher.HOOK_SOURCE);
    const staleAsar = path.join(root, 'stale.asar');
    const currentAsar = path.join(root, 'current.asar');
    await official.createPackage(staleSrc, staleAsar);
    await official.createPackage(currentSrc, currentAsar);
    assert.strictEqual(patcher.isPatched(staleAsar), true);
    assert.strictEqual(patcher.isPatchCurrent(staleAsar), false);
    assert.strictEqual(patcher.isPatchCurrent(currentAsar), true);

    const oldHookSrc = path.join(root, 'old-hook');
    fs.mkdirSync(oldHookSrc);
    fs.copyFileSync(path.join(currentSrc, patcher.ENGINE_FILE), path.join(oldHookSrc, patcher.ENGINE_FILE));
    fs.writeFileSync(path.join(oldHookSrc, patcher.HOOK_FILE), 'old hook bytes');
    const oldHookAsar = path.join(root, 'old-hook.asar');
    await official.createPackage(oldHookSrc, oldHookAsar);
    assert.strictEqual(patcher.isPatched(oldHookAsar), true);
    assert.strictEqual(patcher.isPatchCurrent(oldHookAsar), false);
  });

  await test('re-patching does not duplicate the hook', async () => {
    const { appRoot } = await makeFakeApp();
    const asarPath = path.join(appRoot, 'resources', 'app.asar');
    assert.ok(patcher.patchApp(appRoot, {}).ok);
    assert.ok(patcher.patchApp(appRoot, {}).ok);
    const main = official.extractFile(asarPath, 'main.js').toString();
    const count = (main.match(/rtl-universal-hook/g) || []).length;
    assert.strictEqual(count, 1);
  });

  await test('unpatch restores the original archive byte-for-byte', async () => {
    const { appRoot, resources } = await makeFakeApp();
    const asarPath = path.join(resources, 'app.asar');
    const before = sha(asarPath);
    assert.ok(patcher.patchApp(appRoot, { mode: 'rtl' }).ok);
    const res = patcher.unpatchApp(appRoot);
    assert.ok(res.ok);
    assert.strictEqual(res.mode, 'restore');
    assert.strictEqual(sha(asarPath), before);
    assert.ok(!fs.existsSync(asarPath + '.rtl-backup'));
  });

  await test('unpatch falls back to surgical removal if backup is gone', async () => {
    const { appRoot } = await makeFakeApp();
    const asarPath = path.join(appRoot, 'resources', 'app.asar');
    assert.ok(patcher.patchApp(appRoot, {}).ok);
    fs.unlinkSync(asarPath + '.rtl-backup');
    const res = patcher.unpatchApp(appRoot);
    assert.ok(res.ok);
    assert.strictEqual(res.mode, 'surgical');
    assert.strictEqual(patcher.isPatched(asarPath), false);
    const main = official.extractFile(asarPath, 'main.js').toString();
    assert.ok(!main.includes('rtl-universal-hook'));
    assert.ok(main.includes("require('electron')"));
  });

  await test('dry-run changes nothing', async () => {
    const { appRoot, resources } = await makeFakeApp();
    const asarPath = path.join(resources, 'app.asar');
    const before = sha(asarPath);
    const res = patcher.patchApp(appRoot, { dryRun: true });
    assert.ok(res.ok && res.dryRun);
    assert.ok(res.plan.scriptFiles.length >= 1);
    assert.strictEqual(sha(asarPath), before);
    assert.ok(!fs.existsSync(asarPath + '.rtl-backup'));
  });

  await test('resolveTarget accepts exe, folder and asar paths', async () => {
    const { appRoot } = await makeFakeApp();
    const asarPath = path.join(appRoot, 'resources', 'app.asar');
    assert.strictEqual(patcher.resolveTarget(appRoot).asar, asarPath);
    assert.strictEqual(patcher.resolveTarget(asarPath).asar, asarPath);
    const fakeExe = path.join(appRoot, 'FakeAgent.exe');
    fs.writeFileSync(fakeExe, 'MZ');
    assert.strictEqual(patcher.resolveTarget(fakeExe).asar, asarPath);
  });

  await test('custom CSS and mode are embedded in config', async () => {
    const { appRoot, resources } = await makeFakeApp();
    const asarPath = path.join(resources, 'app.asar');
    const res = patcher.patchApp(appRoot, { mode: 'rtl', css: 'body{font-family:Vazirmatn}' });
    assert.ok(res.ok, res.error);
    const cfg = JSON.parse(official.extractFile(asarPath, 'rtl-universal.config.json').toString());
    assert.strictEqual(cfg.mode, 'rtl');
    assert.strictEqual(official.extractFile(asarPath, 'rtl-universal.css').toString(), 'body{font-family:Vazirmatn}');
  });

  await test('apps without electron main are rejected safely', async () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-bad-'));
    const resources = path.join(appRoot, 'resources');
    fs.mkdirSync(resources, { recursive: true });
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-badsrc-'));
    fs.writeFileSync(path.join(src, 'package.json'), '{"name":"no-electron"}');
    fs.writeFileSync(path.join(src, 'index.js'), 'console.log(1);');
    await pack(src, path.join(resources, 'app.asar'));
    const res = patcher.patchApp(appRoot, {});
    assert.strictEqual(res.ok, false);
    assert.ok(/main-process/.test(res.error));
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    failures.forEach((f) => console.error('FAILED: ' + f.name + '\n' + f.error.stack + '\n'));
    process.exit(1);
  }
})();
