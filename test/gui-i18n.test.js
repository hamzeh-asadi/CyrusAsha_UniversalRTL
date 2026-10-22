/**
 * تست دوزبانه‌بودن مرکز کنترل (فارسی / English)
 * Run: node test/gui-i18n.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 4491;
const BASE = 'http://127.0.0.1:' + PORT;

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; failures.push({ name, error: e }); console.log('  \u2717 ' + name + ' — ' + e.message); }
}

(async function main() {
  console.log('\nControl Panel i18n tests (browser)\n');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-i18n-home-'));
  const server = spawn(process.execPath, [path.join(ROOT, 'src', 'gui', 'server.js'), '--port', String(PORT)], {
    env: Object.assign({}, process.env, { RTL_UNIVERSAL_HOME: home, PORT: String(PORT) }),
    stdio: 'ignore'
  });

  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + '/api/state');
      if (r.ok) { ready = true; break; }
    } catch (e) { /* wait */ }
    await new Promise((r) => setTimeout(r, 120));
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1320, height: 940 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  try {
    assert.ok(ready, 'server not ready');

    await page.goto(BASE + '/');
    await page.waitForTimeout(700);

    await test('default language is Persian (RTL)', async () => {
      const html = await page.getAttribute('html', 'lang');
      const dir = await page.getAttribute('html', 'dir');
      assert.strictEqual(html, 'fa');
      assert.strictEqual(dir, 'rtl');
      const h1 = await page.locator('h1').innerText();
      assert.ok(h1.includes('مرکز کنترل'), h1);
      const webCard = await page.locator('main').innerText();
      assert.ok(webCard.includes('دانلود بسته‌ی Chrome (.crx)'));
      assert.ok(webCard.includes('دانلود ZIP فروشگاه Chrome / Edge'));
      assert.ok(webCard.includes('دانلود افزونه‌ی Firefox'));
      assert.ok(webCard.includes('Microsoft Copilot'));

      // پیوندهای پایانی هم مقصد درست و هم مشخصات امنِ زبانه‌ی تازه را داشته باشند.
      // Also verify the two requested social links are present and safely opened.
      const footer = page.locator('.site-footer');
      assert.ok((await footer.innerText()).includes('راه‌های ارتباطی با سازنده'));
      const links = footer.locator('a');
      assert.strictEqual(await links.count(), 2);
      assert.strictEqual(await links.nth(0).getAttribute('href'), 'https://github.com/hamzeh-asadi');
      assert.strictEqual(await links.nth(1).getAttribute('href'), 'https://t.me/Asadi_hamzeh');
      assert.strictEqual(await links.nth(0).getAttribute('rel'), 'noopener noreferrer');
      assert.strictEqual(await links.nth(1).getAttribute('rel'), 'noopener noreferrer');
    });

    await test('switch to English flips text and direction', async () => {
      await page.click('.lang button[data-lang="en"]');
      await page.waitForTimeout(300);
      assert.strictEqual(await page.getAttribute('html', 'lang'), 'en');
      assert.strictEqual(await page.getAttribute('html', 'dir'), 'ltr');
      const h1 = await page.locator('h1').innerText();
      assert.ok(h1.includes('Control Panel'), h1);
      const body = await page.locator('main').innerText();
      assert.ok(body.includes('Electron apps'));
      assert.ok(body.includes('Settings'));
      assert.ok(body.includes('Direction tester'));
      assert.ok(body.includes('Web chats'), 'web-chat card missing');
      assert.ok(body.includes('Download packed Chrome extension (.crx)'));
      assert.ok(body.includes('Download Chrome Web Store / Edge ZIP'));
      assert.ok(body.includes('Download Firefox extension'));
      assert.ok(body.includes('Microsoft Copilot'));
      const footerTitle = await page.locator('.footer-label').innerText();
      assert.strictEqual(footerTitle, 'Connect with the developer');
      assert.strictEqual(errors.length, 0, errors.join('; '));
    });

    await test('tester verdict is localized in English', async () => {
      await page.fill('#tester', 'This is an English sentence for testing.');
      await page.waitForTimeout(250);
      const chip = await page.locator('#vchip').innerText();
      assert.ok(chip.includes('LTR'), chip);
      const detail = await page.locator('#vdetail').innerText();
      assert.ok(detail.includes('%'), detail);
    });

    await test('language choice persists after reload', async () => {
      await page.reload();
      await page.waitForTimeout(700);
      assert.strictEqual(await page.getAttribute('html', 'lang'), 'en');
      const h1 = await page.locator('h1').innerText();
      assert.ok(h1.includes('Control Panel'), h1);
    });

    await test('switch back to Persian restores RTL + Persian digits', async () => {
      await page.click('.lang button[data-lang="fa"]');
      await page.waitForTimeout(300);
      assert.strictEqual(await page.getAttribute('html', 'dir'), 'rtl');
      const total = await page.locator('#st-total').innerText();
      assert.ok(/[۰-۹]/.test(total), 'Persian digits expected, got: ' + total);
      const h1 = await page.locator('h1').innerText();
      assert.ok(h1.includes('مرکز کنترل'), h1);
    });

    await test('no stray untranslated i18n keys on screen', async () => {
      const text = await page.locator('body').innerText();
      // کلیدهای ترجمه‌ی ترجمه‌نشده مثل «apps.title» را پیدا می‌کند،
      // اما نام فایل‌های واقعی مثل app.asar را نادیده می‌گیرد.
      const leftover = (text.match(/\b(btn|apps|settings|tester|log|ide|chip|mode|web)\.[a-zA-Z.]+/g) || [])
        .filter((x) => !/asar|\.js|\.json|\.png|\.vsix/.test(x));
      assert.deepStrictEqual(leftover, []);
    });

    await page.screenshot({ path: path.join(ROOT, 'docs', 'screenshots', 'control-panel-fa.png') });
    await page.click('.lang button[data-lang="en"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(ROOT, 'docs', 'screenshots', 'control-panel-en.png') });

  } finally {
    await browser.close();
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    failures.forEach((f) => console.error('FAILED: ' + f.name + '\n' + f.error.stack + '\n'));
    process.exit(1);
  }
  process.exit(0);
})();
