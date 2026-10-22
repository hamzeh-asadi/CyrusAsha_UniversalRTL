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

/* ساخت اپ جعلی. مهم: preload.js نباید هرگز پچ شود و assets دست‌نخورده بماند. */
async function makeFakeApp() {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-app-'));
  const resources = path.join(appRoot, 'resources');
  fs.mkdirSync(resources, { recursive: true });
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-src-'));
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({
    name: 'fake-agent', productName: 'Fake Agent', version: '9.9.9', main: 'main.js'
  }, null, 2));
  fs.writeFileSync(path.join(src, 'main.js'),
    "'use strict';\nconst { app, BrowserWindow } = require('electron');\n" +
    'app.whenReady().then(() => { new BrowserWindow({ width: 800 }); });\n');
  fs.writeFileSync(path.join(src, 'renderer.js'), "console.log('renderer');\n");
  fs.writeFileSync(path.join(src, 'preload.js'), "const { contextBridge } = require('electron');\ncontextBridge.exposeInMainWorld('x', {});\n");
  fs.mkdirSync(path.join(src, 'assets'));
  fs.writeFileSync(path.join(src, 'assets', 'style.css'), 'body{color:red}');
  await official.createPackage(src, path.join(resources, 'app.asar'));
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

    // Runtime files present
    assert.ok(official.extractFile(asarPath, 'rtl-universal.js').toString().includes('web-contents-created'));
    assert.ok(official.extractFile(asarPath, 'rtl-universal-engine.js').toString().includes('CyrusAsha_UniversalRTL-1.0.0'));
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

  await test('isPatched detects patched/unpatched state', async () => {
    const { appRoot, resources } = await makeFakeApp();
    const asarPath = path.join(resources, 'app.asar');
    assert.strictEqual(patcher.isPatched(asarPath), false);
    assert.ok(patcher.patchApp(appRoot, {}).ok);
    assert.strictEqual(patcher.isPatched(asarPath), true);
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
    await official.createPackage(src, path.join(resources, 'app.asar'));
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
