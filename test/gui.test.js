/**
 * End-to-end test of the Control Panel (HTTP API + browser UI).
 * Uses fake Electron apps in a temp scan dir.
 * Run: node test/gui.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const official = require('@electron/asar');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 4488;
const BASE = 'http://127.0.0.1:' + PORT;

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; failures.push({ name, error: e }); console.log('  \u2717 ' + name + ' — ' + e.message); }
}

/* ============================================================================
 * این تست، برنامه را «از بیرون» امتحان می‌کند:
 *   ۱. سرور را در یک پروسه‌ی جدا اجرا می‌کند (مثل کاربر واقعی)
 *   ۲. با fetch به API آن درخواست می‌فرستد
 *   ۳. با Playwright یک مرورگر واقعی باز می‌کند و روی دکمه‌ها کلیک می‌کند
 * نتیجه: مطمئن می‌شویم هم منطق سرور و هم رابط کاربری درست کار می‌کنند.
 * ========================================================================== */
async function api(pathname, body) {
  const res = await fetch(BASE + pathname, body === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function makeFakeApps(base) {
  fs.rmSync(base, { recursive: true, force: true });
  const specs = [
    { dir: 'Alpha Agent', name: 'Alpha Agent', version: '2.1.0', main: 'main.js', electron: true },
    { dir: 'Beta Studio', name: 'Beta Studio', version: '0.9.4', main: 'main.js', electron: true },
    { dir: 'Gamma NoMain', name: 'Gamma NoMain', version: '1.0.0', main: 'index.js', electron: false }
  ];
  for (const s of specs) {
    const appRoot = path.join(base, s.dir);
    fs.mkdirSync(path.join(appRoot, 'resources'), { recursive: true });
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-src-'));
    fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: s.name, productName: s.name, version: s.version, main: s.main }));
    fs.writeFileSync(path.join(src, s.main),
      s.electron ? "const { app } = require('electron');\napp.whenReady().then(()=>{});\n" : 'console.log(1);\n');
    await official.createPackage(src, path.join(appRoot, 'resources', 'app.asar'));
  }
}

async function overwriteEmbeddedEngine(asarPath, engineText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-engine-replace-'));
  await official.extractAll(asarPath, dir);
  fs.writeFileSync(path.join(dir, 'rtl-universal-engine.js'), engineText);
  const replacement = asarPath + '.engine-replacement';
  await official.createPackage(dir, replacement);
  if (process.platform === 'win32') await new Promise((resolve) => setTimeout(resolve, 250));
  fs.renameSync(replacement, asarPath);
}

(async function main() {
  console.log('\nControl Panel tests (HTTP + browser)\n');

  const appsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-gui-apps-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-gui-home-'));
  await makeFakeApps(appsDir);

  const server = spawn(process.execPath, [path.join(ROOT, 'src', 'gui', 'server.js'), '--port', String(PORT)], {
    env: Object.assign({}, process.env, {
      RTL_UNIVERSAL_SCAN_DIRS: appsDir,
      RTL_UNIVERSAL_DISABLE_DEFAULT_SCAN: '1',
      RTL_UNIVERSAL_HOME: homeDir,
      RTL_CHROME_EXTENSION_KEY: path.join(homeDir, 'chrome-test-signing.pem'),
      RTL_CHROME_EXTENSION_OUTPUT: path.join(homeDir, 'CyrusAsha_UniversalRTL-1.0.0-Chrome.crx'),
      PORT: String(PORT)
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = [];
  server.stdout.on('data', (d) => logs.push(String(d)));
  server.stderr.on('data', (d) => logs.push(String(d)));

  // Wait for the server
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const s = await api('/api/state');
      if (s && s.apps) { ready = true; break; }
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 120));
  }

  let browser = null;

  try {
    await test('server starts and discovers fake apps', async () => {
      assert.ok(ready, 'server did not start: ' + logs.join(''));
      const s = await api('/api/state');
      const names = s.apps.map((a) => a.name).sort();
      assert.deepStrictEqual(names, ['Alpha Agent', 'Beta Studio', 'Gamma NoMain']);
      assert.strictEqual(s.stats.total, 3);
      assert.strictEqual(s.stats.patched, 0);
    });

    await test('patch endpoint patches a real app and reports status', async () => {
      const s = await api('/api/state');
      const alpha = s.apps.find((a) => a.name === 'Alpha Agent');
      const r = await api('/api/patch', { appRoot: alpha.appRoot });
      assert.ok(r.ok, JSON.stringify(r));
      const after = await api('/api/state');
      const alpha2 = after.apps.find((a) => a.name === 'Alpha Agent');
      assert.strictEqual(alpha2.patched, true);
      assert.strictEqual(alpha2.patchCurrent, true);
      assert.strictEqual(alpha2.backup, true);
      // Verify asar contents
      const main = official.extractFile(alpha2.asar, 'main.js').toString();
      assert.ok(main.includes('rtl-universal-hook'));
      assert.ok(official.extractFile(alpha2.asar, 'rtl-universal-engine.js').toString().includes('CyrusAsha_UniversalRTL-1.0.0'));
    });

    await test('unpatch endpoint restores the archive', async () => {
      const s = await api('/api/state');
      const alpha = s.apps.find((a) => a.name === 'Alpha Agent');
      const before = fs.readFileSync(alpha.asar + '.rtl-backup');
      const r = await api('/api/unpatch', { appRoot: alpha.appRoot });
      assert.ok(r.ok, JSON.stringify(r));
      const after = await api('/api/state');
      const alpha2 = after.apps.find((a) => a.name === 'Alpha Agent');
      assert.strictEqual(alpha2.patched, false);
      assert.deepStrictEqual(fs.readFileSync(alpha2.asar), before);
    });

    await test('patch-all skips apps without an Electron main (graceful failure)', async () => {
      const r = await api('/api/patch-all', { mode: 'smart' });
      const results = r.results.map((x) => ({ name: x.name, ok: x.ok }));
      const alpha = results.find((x) => x.name === 'Alpha Agent');
      const beta = results.find((x) => x.name === 'Beta Studio');
      const gamma = results.find((x) => x.name === 'Gamma NoMain');
      assert.strictEqual(alpha.ok, true);
      assert.strictEqual(beta.ok, true);
      assert.strictEqual(gamma.ok, false, 'Gamma has no electron main and must not be patched');
      const s = await api('/api/state');
      assert.strictEqual(s.stats.patched, 2);
    });

    await test('Control Panel detects a patched app carrying an older engine', async () => {
      const s = await api('/api/state');
      const beta = s.apps.find((a) => a.name === 'Beta Studio');
      assert.strictEqual(beta.patchCurrent, true);
      await overwriteEmbeddedEngine(beta.asar, 'stale engine from an earlier build');
      const staleState = await api('/api/state');
      const betaStale = staleState.apps.find((a) => a.name === 'Beta Studio');
      assert.strictEqual(betaStale.patched, true);
      assert.strictEqual(betaStale.patchCurrent, false);
      assert.strictEqual(staleState.stats.patched, 1);
      assert.strictEqual(staleState.stats.outdated, 1);
    });

    await test('patch-all updates stale engines even when the app is already marked patched', async () => {
      const before = await api('/api/state');
      const beta = before.apps.find((a) => a.name === 'Beta Studio');
      assert.strictEqual(beta.patchCurrent, false);
      const result = await api('/api/patch-all', { mode: 'smart' });
      const betaResult = result.results.find((item) => item.name === 'Beta Studio');
      assert.ok(betaResult && betaResult.ok, JSON.stringify(betaResult));
      let after = await api('/api/state');
      let betaAfter = after.apps.find((a) => a.name === 'Beta Studio');
      assert.strictEqual(betaAfter.patchCurrent, true);
      // Leave the test app stale once more so the browser UI's Update button is exercised below.
      await overwriteEmbeddedEngine(betaAfter.asar, 'stale engine for the UI update test');
      after = await api('/api/state');
      betaAfter = after.apps.find((a) => a.name === 'Beta Studio');
      assert.strictEqual(betaAfter.patchCurrent, false);
    });

    await test('settings persist to disk', async () => {
      const r = await api('/api/settings', { mode: 'rtl', inputs: false, monacoChatInput: false, extraCSS: 'body{}' });
      assert.ok(r.ok);
      const cfg = JSON.parse(fs.readFileSync(path.join(homeDir, 'config.json'), 'utf8'));
      assert.strictEqual(cfg.mode, 'rtl');
      assert.strictEqual(cfg.inputs, false);
      assert.strictEqual(cfg.extraCSS, 'body{}');
      // restore defaults for later tests
      await api('/api/settings', { mode: 'smart', inputs: true, monacoChatInput: true, extraCSS: '' });
    });

    await test('engine.js route serves the real engine', async () => {
      const res = await fetch(BASE + '/engine.js');
      const text = await res.text();
      assert.ok(text.includes('__RTL_UNIVERSAL_CONFIG__'));
      assert.ok(text.includes('RTLUniversal'));
    });

    /* چت‌های وب در مرورگر اجرا می‌شوند و VSIX آنجا نصب نمی‌شود؛ مسیر نصب
     * یوزراسکریپت باید یک اسکریپت واقعی با سرصفحه‌ی Tampermonkey بدهد. */
    await test('userscript install route serves a Tampermonkey script', async () => {
      const res = await fetch(BASE + '/install/rtl-universal.user.js');
      assert.strictEqual(res.status, 200);
      assert.ok((res.headers.get('content-type') || '').includes('javascript'), 'wrong content-type');
      const body = await res.text();
      assert.ok(body.startsWith('// ==UserScript=='), body.slice(0, 60));
      assert.ok(body.includes('@match'), 'no @match rules');
      assert.ok(body.includes('RTLUniversal'), 'engine body missing');
    });

    await test('Control Panel header uses and serves the CyrusAsha logo', async () => {
      const page = await fetch(BASE + '/');
      const html = await page.text();
      assert.strictEqual(page.status, 200);
      assert.ok(html.includes('<img class="logo" src="/brand/CyrusAsha_UniversalRTL.png"'), 'header does not reference the branded image');
      const res = await fetch(BASE + '/brand/CyrusAsha_UniversalRTL.png');
      const data = Buffer.from(await res.arrayBuffer());
      const source = fs.readFileSync(path.join(ROOT, 'src', 'gui', 'public', 'brand', 'CyrusAsha_UniversalRTL.png'));
      assert.strictEqual(res.status, 200);
      assert.ok((res.headers.get('content-type') || '').includes('image/png'));
      assert.deepStrictEqual(data, source);
    });

    await test('Chrome store package route downloads the branded ZIP', async () => {
      const res = await fetch(BASE + '/install/browser/chrome.zip');
      const data = Buffer.from(await res.arrayBuffer());
      assert.strictEqual(res.status, 200);
      assert.ok((res.headers.get('content-disposition') || '').includes('CyrusAsha_UniversalRTL-1.0.0-Chrome.zip'));
      assert.strictEqual(data.readUInt32LE(0), 0x04034b50, 'not a ZIP file');
    });

    await test('packed Chrome route downloads a valid CRX3 file, not an unpacked folder', async () => {
      const res = await fetch(BASE + '/install/browser/chrome.crx');
      const data = Buffer.from(await res.arrayBuffer());
      assert.strictEqual(res.status, 200);
      assert.ok((res.headers.get('content-disposition') || '').includes('CyrusAsha_UniversalRTL-1.0.0-Chrome.crx'));
      assert.ok((res.headers.get('content-type') || '').includes('application/x-chrome-extension'));
      assert.strictEqual(data.toString('ascii', 0, 4), 'Cr24', 'missing CRX magic');
      assert.strictEqual(data.readUInt32LE(4), 3, 'expected CRX version 3');
      const zipOffset = 12 + data.readUInt32LE(8);
      assert.strictEqual(data.readUInt32LE(zipOffset), 0x04034b50, 'CRX payload is not a ZIP');
    });

    await test('Firefox route downloads the unsigned XPI package', async () => {
      const res = await fetch(BASE + '/install/browser/firefox.xpi');
      const data = Buffer.from(await res.arrayBuffer());
      assert.strictEqual(res.status, 200);
      assert.ok((res.headers.get('content-disposition') || '').includes('-Firefox.xpi'));
      assert.strictEqual(data.readUInt32LE(0), 0x04034b50, 'XPI must be a ZIP container');
    });

    await test('bookmarklet route serves javascript: one-liner', async () => {
      const res = await fetch(BASE + '/install/bookmarklet.txt');
      const body = await res.text();
      assert.strictEqual(res.status, 200);
      assert.ok(body.startsWith('javascript:'), body.slice(0, 40));
    });

    await test('add-path rejects invalid paths', async () => {
      const r = await api('/api/add-path', { path: '/definitely/not/here' });
      assert.strictEqual(r.ok, false);
      assert.ok(r.error);
    });

    /* ---------------- browser UI ---------------- */
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1320, height: 950 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(BASE + '/');
    await page.waitForSelector('.app', { timeout: 10000 });

    await test('Control Panel links to the official Firefox Add-ons listing', async () => {
      const links = page.locator('a[href="https://addons.mozilla.org/en-US/firefox/addon/cyrusasha_universalrtl/"]');
      assert.strictEqual(await links.count(), 2, 'expected links in the browser-extension card and panel footer');
      for (const link of await links.all()) {
        assert.strictEqual(await link.getAttribute('target'), '_blank');
        assert.strictEqual(await link.getAttribute('rel'), 'noopener noreferrer');
      }
    });

    await test('UI offers Update for a stale patch and refreshes the embedded engine', async () => {
      const card = page.locator('.app', { hasText: 'Beta Studio' });
      assert.ok((await card.innerText()).includes('نیازمند به‌روزرسانی'));
      const update = card.locator('button[data-act="patch"]');
      assert.strictEqual(await update.innerText(), 'به‌روزرسانی پچ');
      await update.click();
      await page.waitForFunction(async () => {
        const response = await fetch('/api/state');
        const state = await response.json();
        const beta = state.apps.find((app) => app.name === 'Beta Studio');
        return beta && beta.patched && beta.patchCurrent;
      }, null, { timeout: 10000 });
      await card.locator('.chip.on').waitFor({ timeout: 5000 });
      assert.ok((await card.innerText()).includes('پچ‌شده'));
      assert.strictEqual(await card.locator('button[data-act="unpatch"]').count(), 1);
    });

    await test('UI displays the updated CyrusAsha logo in the header', async () => {
      const logo = page.locator('header.topbar img.logo');
      await logo.waitFor();
      await page.waitForFunction(() => {
        const image = document.querySelector('header.topbar img.logo');
        return image && image.complete && image.naturalWidth === 512 && image.naturalHeight === 512;
      });
      const src = await logo.getAttribute('src');
      assert.strictEqual(src, '/brand/CyrusAsha_UniversalRTL.png');
      assert.strictEqual(await page.locator('link[rel="icon"]').getAttribute('href'), '/brand/CyrusAsha_UniversalRTL.png');
    });

    await test('UI renders app cards with Persian labels', async () => {
      const count = await page.locator('.app').count();
      assert.strictEqual(count, 3);
      const text = await page.locator('main').innerText();
      assert.ok(text.includes('پچ‌شده'));
      assert.ok(text.includes('Alpha Agent'));
      assert.strictEqual(pageErrors.length, 0, pageErrors.join('; '));
    });

    await test('UI unpatch button restores an app and updates the badge', async () => {
      const card = page.locator('.app', { hasText: 'Alpha Agent' });
      await card.locator('button', { hasText: 'حذف پچ' }).click();
      await page.waitForTimeout(1200);
      const s = await api('/api/state');
      assert.strictEqual(s.apps.find((a) => a.name === 'Alpha Agent').patched, false);
      const text = await card.innerText();
      assert.ok(text.includes('پچ‌نشده'));
    });

    await test('UI patch button patches again', async () => {
      const card = page.locator('.app', { hasText: 'Alpha Agent' });
      await card.locator('button', { hasText: /^پچ$/ }).click();
      await page.waitForTimeout(1400);
      const s = await api('/api/state');
      assert.strictEqual(s.apps.find((a) => a.name === 'Alpha Agent').patched, true);
    });

    await test('UI mode switch + save persists settings', async () => {
      await page.locator('#mode-seg button[data-mode="rtl"]').click();
      await page.locator('#btn-save').click();
      await page.waitForTimeout(700);
      const cfg = JSON.parse(fs.readFileSync(path.join(homeDir, 'config.json'), 'utf8'));
      assert.strictEqual(cfg.mode, 'rtl');
      await page.locator('#mode-seg button[data-mode="smart"]').click();
      await page.locator('#btn-save').click();
      await page.waitForTimeout(500);
    });

    await test('UI tester shows RTL verdict for Persian', async () => {
      await page.fill('#tester', 'این یک متن فارسی برای تست است.');
      await page.waitForTimeout(300);
      const chip = await page.locator('#vchip').innerText();
      assert.ok(chip.includes('RTL'), chip);
      await page.fill('#tester', 'This is an English sentence for testing.');
      await page.waitForTimeout(300);
      const chip2 = await page.locator('#vchip').innerText();
      assert.ok(chip2.includes('LTR'), chip2);
    });

    await test('UI live log receives entries', async () => {
      const logText = await page.locator('#log').innerText();
      assert.ok(logText.length > 10, 'log should not be empty');
    });

    await page.screenshot({ path: path.join(ROOT, 'demo', 'gui-screenshot.png'), fullPage: false });
    await page.close();

  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    if (!server.killed) server.kill('SIGKILL');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    failures.forEach((f) => console.error('FAILED: ' + f.name + '\n' + f.error.stack + '\n'));
    process.exit(1);
  }
  process.exit(0);
})();
