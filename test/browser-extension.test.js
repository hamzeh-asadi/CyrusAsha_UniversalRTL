/*
 * Browser-extension package tests / تست بسته‌های افزونه‌ی مرورگر
 * Run: node scripts/build-browser-extension.js && node test/browser-extension.test.js
 *
 * These tests validate the real generated Chrome/Firefox files and exercise the
 * settings bridge against jsdom. They do not pretend to submit or sign either
 * browser-store package.
 * این تست‌ها فایل‌های ساخته‌شده را بررسی می‌کنند و پل تنظیمات را با jsdom
 * اجرا می‌کنند؛ آن‌ها به‌اشتباه ادعا نمی‌کنند که بسته در فروشگاه منتشر/امضا شده.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { buildChromeCrx } = require('../scripts/build-chrome-crx');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'release', 'browser');
const PKG = require(path.join(ROOT, 'package.json'));
const SITES = JSON.parse(fs.readFileSync(path.join(ROOT, 'browser-extension', 'sites.json'), 'utf8'));
const CHROME = path.join(OUTPUT, 'chrome-unpacked');
const FIREFOX = path.join(OUTPUT, 'firefox-unpacked');
const PRODUCT_NAME = 'CyrusAsha_UniversalRTL';
const SETTINGS_KEY = 'rtlUniversalSettings';
const CHROME_ZIP = path.join(OUTPUT, PRODUCT_NAME + '-' + PKG.version + '-Chrome.zip');
const FIREFOX_XPI = path.join(OUTPUT, PRODUCT_NAME + '-' + PKG.version + '-Firefox.xpi');

let passed = 0;
let failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (error) { failed++; failures.push({ name, error }); console.log('  ✗ ' + name + ' — ' + error.message); }
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/* Set up a realistic content-script page with the callback-style Chrome storage
 * API. The extension must wait for saved settings before touching the DOM. */
function makeExtensionPage(url, savedSettings) {
  const html = '<!doctype html><html><head></head><body><div class="markdown"><p id="message">سلام دنیا</p></div></body></html>';
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url });
  const listeners = [];
  dom.window.chrome = {
    storage: {
      local: {
        get: function (key, callback) {
          const result = {};
          result[key] = savedSettings;
          callback(result);
        }
      },
      onChanged: { addListener: function (callback) { listeners.push(callback); } }
    },
    runtime: { lastError: null }
  };

  // Match the manifest order: site data, delayed-start flag, engine, settings bridge.
  dom.window.eval(fs.readFileSync(path.join(CHROME, 'site-config.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(CHROME, 'bootstrap.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(CHROME, 'rtl-engine.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(CHROME, 'content.js'), 'utf8'));
  return { dom, listeners };
}

function makeMockEvent() {
  const listeners = [];
  return {
    addListener: function (callback) { listeners.push(callback); },
    fire: function () { listeners.slice().forEach((callback) => callback.apply(null, arguments)); }
  };
}

function makePopupEnvironment(savedSettings, permissionResult) {
  const html = fs.readFileSync(path.join(ROOT, 'browser-extension', 'popup.html'), 'utf8');
  const popupJs = fs.readFileSync(path.join(ROOT, 'browser-extension', 'popup.js'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://extension.invalid/popup.html' });
  const storage = { [SETTINGS_KEY]: savedSettings || null };
  const calls = { requests: [], removals: [] };
  dom.window.RTL_UNIVERSAL_SITES = SITES;
  dom.window.browser = {
    storage: {
      local: {
        get: (key) => Promise.resolve({ [key]: storage[key] }),
        set: (record) => { Object.assign(storage, record); return Promise.resolve(); }
      }
    },
    permissions: {
      request: (permissions) => { calls.requests.push(permissions); return Promise.resolve(permissionResult); },
      remove: (permissions) => { calls.removals.push(permissions); return Promise.resolve(true); }
    }
  };
  dom.window.eval(popupJs);
  return { dom, storage, calls };
}

(async function main() {
  console.log('\nBrowser extension tests (Chrome + Firefox)\n');

  await test('Chrome package uses Manifest V3 and the current project version', async () => {
    const manifest = readJson(path.join(CHROME, 'manifest.json'));
    assert.strictEqual(manifest.manifest_version, 3);
    assert.strictEqual(manifest.version, PKG.version);
    assert.strictEqual(manifest.name, '__MSG_extName__');
    assert.strictEqual(manifest.default_locale, 'en');
  });

  await test('Firefox package has its own ID and declares no data collection', async () => {
    const manifest = readJson(path.join(FIREFOX, 'manifest.json'));
    assert.strictEqual(manifest.manifest_version, 3);
    assert.strictEqual(manifest.version, PKG.version);
    assert.ok(manifest.browser_specific_settings.gecko.id);
    assert.deepStrictEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
    assert.strictEqual(manifest.browser_specific_settings.gecko.strict_min_version, '140.0');
    assert.strictEqual(manifest.browser_specific_settings.gecko_android.strict_min_version, '142.0');
    assert.strictEqual(manifest.minimum_chrome_version, undefined);
  });

  await test('the same AI-chat list is used in both browsers; Copilot is included, Bing search is not', async () => {
    const chrome = readJson(path.join(CHROME, 'manifest.json'));
    const firefox = readJson(path.join(FIREFOX, 'manifest.json'));
    const chromeMatches = chrome.content_scripts[0].matches;
    const firefoxMatches = firefox.content_scripts[0].matches;
    assert.deepStrictEqual(chromeMatches, firefoxMatches);
    assert.ok(chromeMatches.includes('https://copilot.microsoft.com/*'));
    assert.ok(!chromeMatches.some((match) => /bing\.com/.test(match)), 'regular Bing search should stay untouched');
    assert.strictEqual(SITES.length, 21);
  });

  await test('browser API permissions are limited and custom host access is optional', async () => {
    for (const folder of [CHROME, FIREFOX]) {
      const manifest = readJson(path.join(folder, 'manifest.json'));
      assert.deepStrictEqual(manifest.permissions, ['storage', 'scripting']);
      assert.deepStrictEqual(manifest.optional_host_permissions, ['https://*/*']);
      assert.strictEqual(manifest.host_permissions, undefined);
      assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
      assert.ok(!manifest.permissions.includes('tabs'));
      assert.ok(!manifest.permissions.includes('activeTab'));
      assert.deepStrictEqual(manifest.background, folder === CHROME
        ? { service_worker: 'background.js' }
        : { scripts: ['background.js'] });
    }
  });

  await test('content scripts run at document_start in the dependency-safe order', async () => {
    for (const folder of [CHROME, FIREFOX]) {
      const scripts = readJson(path.join(folder, 'manifest.json')).content_scripts[0];
      assert.strictEqual(scripts.run_at, 'document_start');
      assert.deepStrictEqual(scripts.js, ['site-config.js', 'bootstrap.js', 'rtl-engine.js', 'content.js']);
      assert.strictEqual(scripts.all_frames, false);
    }
  });

  await test('both packages include the exact shared engine source', async () => {
    const canonical = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'rtl-engine.js'));
    for (const folder of [CHROME, FIREFOX]) {
      assert.deepStrictEqual(fs.readFileSync(path.join(folder, 'rtl-engine.js')), canonical);
    }
  });

  await test('every declared site has HTTPS matches, host mapping, and bilingual names', async () => {
    const manifestMatches = readJson(path.join(CHROME, 'manifest.json')).content_scripts[0].matches;
    const ids = new Set();
    for (const site of SITES) {
      assert.ok(site.id && !ids.has(site.id), 'site IDs must be unique');
      ids.add(site.id);
      assert.ok(site.label.fa && site.label.en, 'missing bilingual label for ' + site.id);
      assert.ok(site.hosts.length && site.matches.length, 'missing host mapping for ' + site.id);
      site.matches.forEach((match) => {
        assert.ok(match.startsWith('https://'), 'only HTTPS sites should be matched: ' + match);
        assert.ok(manifestMatches.includes(match), 'manifest omitted ' + match);
      });
    }
  });

  await test('Chrome and Firefox manifests reference the CyrusAsha brand icons at each declared size', async () => {
    const expectedSizes = [16, 32, 48, 128];
    const readPngSize = (file) => {
      const data = fs.readFileSync(file);
      assert.strictEqual(data.toString('hex', 0, 8), '89504e470d0a1a0a', file + ' is not a PNG');
      return [data.readUInt32BE(16), data.readUInt32BE(20)];
    };
    for (const folder of [CHROME, FIREFOX]) {
      const manifest = readJson(path.join(folder, 'manifest.json'));
      expectedSizes.forEach((size) => {
        const iconPath = manifest.icons[String(size)];
        assert.ok(iconPath, 'manifest missing ' + size + 'px icon');
        assert.deepStrictEqual(readPngSize(path.join(folder, iconPath)), [size, size]);
      });
    }
    assert.deepStrictEqual(readPngSize(path.join(ROOT, 'vscode-extension', 'media', 'icon.png')), [128, 128]);
    assert.deepStrictEqual(readPngSize(path.join(ROOT, 'assets', 'CyrusAsha_UniversalRTL-logo.png')), [2048, 2048]);
  });

  await test('popup is local, bilingual, and has a global switch, mode selector, and site switches', async () => {
    const html = fs.readFileSync(path.join(CHROME, 'popup.html'), 'utf8');
    const popup = fs.readFileSync(path.join(CHROME, 'popup.js'), 'utf8');
    const css = fs.readFileSync(path.join(CHROME, 'popup.css'), 'utf8');
    assert.ok(html.includes('id="enabled"'));
    assert.ok(html.includes('id="mode"'));
    assert.ok(html.includes('id="site-list"'));
    assert.ok(html.includes('id="custom-site-form"') && html.includes('id="custom-site-input"'));
    assert.ok(html.includes('id="custom-site-list"'));
    assert.ok(popup.includes("fa:") && popup.includes("en:"));
    assert.ok(popup.includes('requestHostPermission') && popup.includes('removeHostPermission'));
    assert.ok(css.includes('.site-item') && css.includes('.custom-site-item'));
    assert.ok(!/<script>[^<]/i.test(html), 'popup must not use inline JavaScript');
  });

  await test('Chrome and Firefox popups link to GitHub, Telegram, and the official Firefox Add-ons page', async () => {
    for (const folder of [CHROME, FIREFOX]) {
      const html = fs.readFileSync(path.join(folder, 'popup.html'), 'utf8');
      assert.ok(html.includes('href="https://github.com/hamzeh-asadi"'));
      assert.ok(html.includes('href="https://t.me/Asadi_hamzeh"'));
      assert.ok(html.includes('href="https://addons.mozilla.org/en-US/firefox/addon/cyrusasha_universalrtl/"'));
      assert.ok(html.includes('data-text="firefoxAddons"'));
      assert.ok(html.includes('Developer and add-on links') || html.includes('پیوندهای سازنده و افزونه'));
      assert.ok((html.match(/target="_blank"/g) || []).length >= 3);
      assert.ok((html.match(/rel="noopener noreferrer"/g) || []).length >= 3);
    }
  });

  await test('popup can add and remove a user-approved HTTPS custom site', async () => {
    const popup = makePopupEnvironment({ enabled: true, mode: 'smart', sites: {}, customSites: [] }, true);
    try {
      await wait(20);
      const input = popup.dom.window.document.getElementById('custom-site-input');
      input.value = 'https://mychat.example/path';
      popup.dom.window.document.getElementById('custom-site-form').dispatchEvent(
        new popup.dom.window.Event('submit', { bubbles: true, cancelable: true })
      );
      await wait(40);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(popup.calls.requests[0])), { origins: ['https://mychat.example/*'] });
      assert.strictEqual(popup.storage[SETTINGS_KEY].customSites[0].host, 'mychat.example');
      assert.strictEqual(popup.storage[SETTINGS_KEY].sites['custom:mychat.example'], true);
      assert.ok(popup.dom.window.document.querySelector('.custom-site-host').textContent === 'mychat.example');
      popup.dom.window.document.querySelector('.custom-site-remove').click();
      await wait(40);
      assert.strictEqual(popup.storage[SETTINGS_KEY].customSites.length, 0);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(popup.calls.removals[0])), { origins: ['https://mychat.example/*'] });
    } finally {
      popup.dom.window.close();
    }
  });

  await test('custom-site form rejects HTTP and leaves a denied host unregistered', async () => {
    const popup = makePopupEnvironment({ enabled: true, mode: 'smart', sites: {}, customSites: [] }, false);
    try {
      await wait(20);
      const input = popup.dom.window.document.getElementById('custom-site-input');
      const form = popup.dom.window.document.getElementById('custom-site-form');
      input.value = 'http://insecure.example';
      form.dispatchEvent(new popup.dom.window.Event('submit', { bubbles: true, cancelable: true }));
      await wait(10);
      assert.strictEqual(popup.calls.requests.length, 0, 'HTTP must be rejected before asking for permission');
      assert.ok(popup.dom.window.document.getElementById('notice').textContent.includes('HTTPS'));
      input.value = 'denied.example';
      form.dispatchEvent(new popup.dom.window.Event('submit', { bubbles: true, cancelable: true }));
      await wait(30);
      assert.strictEqual(popup.calls.requests.length, 1);
      assert.strictEqual(popup.storage[SETTINGS_KEY].customSites.length, 0);
      assert.ok(popup.dom.window.document.getElementById('notice').textContent.includes('Permission'));
      input.value = 'chatgpt.com';
      form.dispatchEvent(new popup.dom.window.Event('submit', { bubbles: true, cancelable: true }));
      await wait(10);
      assert.strictEqual(popup.calls.requests.length, 1, 'a fully covered built-in host should not be added twice');
      input.value = 'x.com';
      form.dispatchEvent(new popup.dom.window.Event('submit', { bubbles: true, cancelable: true }));
      await wait(30);
      assert.strictEqual(popup.calls.requests.length, 2, 'a path-limited built-in host can be added for other paths');
      assert.strictEqual(popup.calls.requests[1].origins[0], 'https://x.com/*');
    } finally {
      popup.dom.window.close();
    }
  });

  await test('localized extension names and descriptions exist for Persian and English', async () => {
    for (const folder of [CHROME, FIREFOX]) {
      const en = readJson(path.join(folder, '_locales', 'en', 'messages.json'));
      const fa = readJson(path.join(folder, '_locales', 'fa', 'messages.json'));
      ['extName', 'extShortName', 'extDescription', 'actionTitle'].forEach((key) => {
        assert.ok(en[key] && en[key].message, 'English locale missing ' + key);
        assert.ok(fa[key] && fa[key].message, 'Persian locale missing ' + key);
      });
      assert.strictEqual(en.extName.message, 'CyrusAsha_UniversalRTL-' + PKG.version);
      assert.strictEqual(fa.extName.message, 'CyrusAsha_UniversalRTL-' + PKG.version);
    }
  });

  await test('Chrome ZIP and Firefox XPI are valid ZIP containers with flat extension roots', async () => {
    for (const file of [CHROME_ZIP, FIREFOX_XPI]) {
      const data = fs.readFileSync(file);
      assert.strictEqual(data.readUInt32LE(0), 0x04034b50, file + ' does not start with a ZIP local header');
      const names = data.toString('utf8');
      for (const expected of ['manifest.json', 'popup.html', 'rtl-engine.js', 'content.js']) {
        assert.ok(names.includes(expected), file + ' is missing ' + expected);
      }
    }
  });

  await test('packed Chrome CRX is CRX3 with a flat ZIP payload and a separate signing key', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyrusasha-crx-test-'));
    const testCrx = path.join(tempDir, 'test.crx');
    const testKey = path.join(tempDir, 'test-signing.pem');
    try {
      await buildChromeCrx({ sourceDir: CHROME, crxPath: testCrx, keyPath: testKey });
      const data = fs.readFileSync(testCrx);
      assert.strictEqual(data.toString('ascii', 0, 4), 'Cr24', 'missing CRX magic');
      assert.strictEqual(data.readUInt32LE(4), 3, 'expected CRX version 3');
      const headerSize = data.readUInt32LE(8);
      assert.ok(headerSize > 0, 'CRX header is empty');
      const zipOffset = 12 + headerSize;
      assert.strictEqual(data.readUInt32LE(zipOffset), 0x04034b50, 'CRX payload must begin with a ZIP file');
      assert.ok(fs.existsSync(testKey), 'signing key should be stored separately from the CRX');
      assert.ok(!fs.existsSync(path.join(OUTPUT, path.basename(testKey))), 'test key must not be copied to release output');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  await test('extension code has no remote script, fetch, analytics, or conversation storage', async () => {
    for (const folder of [CHROME, FIREFOX]) {
      const content = fs.readFileSync(path.join(folder, 'content.js'), 'utf8');
      const popup = fs.readFileSync(path.join(folder, 'popup.js'), 'utf8');
      const background = fs.readFileSync(path.join(folder, 'background.js'), 'utf8');
      const html = fs.readFileSync(path.join(folder, 'popup.html'), 'utf8');
      assert.ok(!/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/.test(content + popup + background));
      assert.ok(!/<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:\/\//i.test(html), 'popup must not load remote assets');
      assert.ok(!/conversation|chatHistory|messageLog/i.test(content), 'settings bridge must not persist conversation content');
    }
  });

  await test('content bridge starts RTL after saved settings and responds to a global off switch', async () => {
    const saved = { enabled: true, mode: 'smart', sites: {} };
    const page = makeExtensionPage('https://chatgpt.com/', saved);
    const dom = page.dom;
    try {
      await wait(90);
      assert.strictEqual(dom.window.RTLUniversal.config.enabled, true);
      assert.strictEqual(dom.window.document.querySelector('#message').getAttribute('data-rtl-dir'), 'rtl');
      assert.strictEqual(page.listeners.length, 1);

      page.listeners[0]({ rtlUniversalSettings: { newValue: { enabled: false, mode: 'smart', sites: {} } } }, 'local');
      assert.strictEqual(dom.window.RTLUniversal.config.enabled, false);
      assert.strictEqual(dom.window.document.querySelector('#message').getAttribute('data-rtl-dir'), null);
    } finally {
      dom.window.close();
    }
  });

  await test('background registers only granted custom HTTPS hosts and removes stale registrations', async () => {
    let settings = {
      enabled: true,
      sites: { 'custom:off.example': false },
      customSites: [
        { host: 'allowed.example' },
        { host: 'denied.example' },
        { host: 'off.example' }
      ]
    };
    let registered = [];
    const onInstalled = makeMockEvent();
    const onStartup = makeMockEvent();
    const onChanged = makeMockEvent();
    const permissionsAdded = makeMockEvent();
    const permissionsRemoved = makeMockEvent();
    const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'outside-only', url: 'https://extension.invalid/' });
    dom.window.browser = {
      runtime: { onInstalled: onInstalled, onStartup: onStartup },
      storage: {
        local: { get: () => Promise.resolve({ rtlUniversalSettings: settings }) },
        onChanged: onChanged
      },
      permissions: {
        contains: ({ origins }) => Promise.resolve(origins[0] === 'https://allowed.example/*' || origins[0] === 'https://off.example/*'),
        onAdded: permissionsAdded,
        onRemoved: permissionsRemoved
      },
      scripting: {
        getRegisteredContentScripts: ({ ids }) => Promise.resolve(registered.filter((item) => !ids || ids.includes(item.id))),
        unregisterContentScripts: ({ ids }) => { registered = registered.filter((item) => !ids.includes(item.id)); return Promise.resolve(); },
        registerContentScripts: (scripts) => { registered.push(...scripts); return Promise.resolve(); }
      }
    };
    try {
      dom.window.eval(fs.readFileSync(path.join(ROOT, 'browser-extension', 'background.js'), 'utf8'));
      onInstalled.fire({ reason: 'install' });
      await wait(50);
      assert.strictEqual(registered.length, 1);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(registered[0].matches)), ['https://allowed.example/*']);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(registered[0].js)), ['site-config.js', 'bootstrap.js', 'rtl-engine.js', 'content.js']);
      assert.strictEqual(registered[0].runAt, 'document_start');
      assert.strictEqual(registered[0].persistAcrossSessions, true);
      settings = { enabled: false, sites: {}, customSites: [{ host: 'allowed.example' }] };
      onChanged.fire({ rtlUniversalSettings: { newValue: settings } }, 'local');
      await wait(50);
      assert.strictEqual(registered.length, 0, 'global-off must remove dynamic registration');
    } finally {
      dom.window.close();
    }
  });

  await test('content bridge enables and cleanly removes RTL on a saved custom host', async () => {
    const saved = { enabled: true, mode: 'smart', sites: {}, customSites: [{ host: 'mychat.example' }] };
    const page = makeExtensionPage('https://mychat.example/chat', saved);
    const dom = page.dom;
    try {
      await wait(90);
      assert.strictEqual(dom.window.RTLUniversal.config.enabled, true);
      assert.strictEqual(dom.window.document.querySelector('#message').getAttribute('data-rtl-dir'), 'rtl');
      page.listeners[0]({ rtlUniversalSettings: { newValue: { enabled: true, mode: 'smart', sites: {}, customSites: [] } } }, 'local');
      assert.strictEqual(dom.window.RTLUniversal.config.enabled, false);
      assert.strictEqual(dom.window.document.querySelector('#message').getAttribute('data-rtl-dir'), null);
    } finally {
      dom.window.close();
    }
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    failures.forEach((failure) => console.error('FAILED: ' + failure.name + '\n' + failure.error.stack + '\n'));
    process.exit(1);
  }
})();
