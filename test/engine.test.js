/**
 * CyrusAsha_UniversalRTL-1.0.0 — engine tests (jsdom)
 * Run: npm test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

/* ============================================================================
 * این تست چطور کار می‌کند؟
 * ----------------------------------------------------------------------------
 * jsdom یک پیاده‌سازی جاوااسکریپتی از DOM مرورگر است. یعنی می‌توانیم صفحه‌ی
 * HTML بسازیم و موتور را روی آن اجرا کنیم، بدون باز کردن مرورگر واقعی.
 *
 * الگوی هر تست:
 *   ۱. makeDom(...) → یک صفحه‌ی کوچک با HTML مورد نظر + موتور
 *   ۲. صبر کوتاه (wait) → چون پردازش DOM غیرهمگام (async) است
 *   ۳. assert → بررسی اینکه جهت درست اعمال شده یا کد دست نخورده
 * ========================================================================== */
const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'rtl-engine.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];

/* یک صفحه‌ی مستقل jsdom می‌سازد و موتور را داخلش اجرا می‌کند.
 * config به موتور داده می‌شود (مثل حالت smart یا سلکتور سفارشی). */
function makeDom(bodyHtml, config) {
  const cfgScript = '<script>window.__RTL_UNIVERSAL_CONFIG__ = ' + JSON.stringify(config || {}) + ';</script>';
  const dom = new JSDOM(
    `<!doctype html><html><head>${cfgScript}</head><body>${bodyHtml}</body></html>`,
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://chat.example.com/' }
  );
  dom.window.eval(ENGINE_SRC);
  return dom;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function dirOf(dom, selector) {
  const el = dom.window.document.querySelector(selector);
  return el ? el.getAttribute('dir') : undefined;
}

function markedDirOf(dom, selector) {
  const el = dom.window.document.querySelector(selector);
  return el ? el.getAttribute('data-rtl-dir') : null;
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log('  \u2717 ' + name + '\n      ' + String(e.message).split('\n')[0]);
  }
}

/* فهرست تست‌ها.
 * هر تست مستقل است: صفحه‌ی خودش را می‌سازد و در پایان می‌بندد. */
(async function main() {
  console.log('\nCyrusAsha_UniversalRTL-1.0.0 — engine tests\n');

  /* ---------------- Direction detection core ---------------- */
  await test('pure Persian paragraph becomes rtl', async () => {
    const dom = makeDom('<div class="markdown"><p>سلام دنیا، این یک پیام فارسی است.</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '.markdown p'), 'rtl');
    assert.strictEqual(dirOf(dom, '.markdown'), 'rtl');
    dom.window.close();
  });

  await test('pure English paragraph becomes ltr', async () => {
    const dom = makeDom('<div class="markdown"><p>Hello world, this is an English message.</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '.markdown p'), 'ltr');
    dom.window.close();
  });

  await test('Persian-majority mixed sentence becomes rtl', async () => {
    const dom = makeDom('<div class="markdown"><p>این متن درباره React hooks و useEffect است و کاملاً فارسی نوشته شده است.</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '.markdown p'), 'rtl');
    dom.window.close();
  });

  await test('English-majority sentence with one Persian word becomes ltr', async () => {
    const dom = makeDom('<div class="markdown"><p>We should deploy the service and then call it سلام for testing.</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '.markdown p'), 'ltr');
    dom.window.close();
  });

  await test('numbers-only block is left untouched', async () => {
    const dom = makeDom('<div class="markdown"><p>12345 67890</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '.markdown p'), null);
    dom.window.close();
  });

  await test('Hebrew text is detected as rtl', async () => {
    const dom = makeDom('<div class="markdown"><p>שלום עולם, זו הודעה בעברית.</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '.markdown p'), 'rtl');
    dom.window.close();
  });

  /* ============================================================================
 * محافظت از کد — مهم‌ترین دسته‌ی تست این پروژه.
 * اگر روزی تغییری دادید که این تست‌ها شکستند، تغییر را قبول نکنید.
 * ========================================================================== */
/* ---------------- Code protection ---------------- */
  await test('code block inside Persian message stays ltr & unmarked', async () => {
    const dom = makeDom(
      '<div class="markdown"><p>برای نصب این دستور را اجرا کنید:</p>' +
      '<pre><code>npm install rtl-universal --save</code></pre></div>'
    );
    await wait(80);
    assert.strictEqual(dirOf(dom, '.markdown'), 'rtl');
    assert.strictEqual(markedDirOf(dom, 'pre'), null);
    assert.strictEqual(markedDirOf(dom, 'pre code'), null);
    dom.window.close();
  });

  await test('Persian message heavy with English code is still rtl (code excluded from detection)', async () => {
    const dom = makeDom(
      '<div class="markdown"><p>این کد را استفاده کن</p>' +
      '<pre><code>const x = someVeryLongEnglishIdentifierIhopeYouAgree(anotherLongIdentifier, thirdIdentifier);</code></pre></div>'
    );
    await wait(80);
    assert.strictEqual(dirOf(dom, '.markdown'), 'rtl');
    dom.window.close();
  });

  await test('inline code does not flip an English paragraph to rtl', async () => {
    const dom = makeDom('<div class="markdown"><p>Use <code>useState</code> for state and <code>سلام</code> is not a hook.</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '.markdown p'), 'ltr');
    dom.window.close();
  });

  /* ---------------- Streaming / dynamic DOM ---------------- */
  await test('streaming text change re-evaluates direction (ltr → rtl)', async () => {
    const dom = makeDom('<div class="markdown"><p id="msg">Hello</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '#msg'), 'ltr');
    dom.window.document.getElementById('msg').textContent = 'سلام دنیا این پیام فارسی است';
    await wait(120);
    assert.strictEqual(dirOf(dom, '#msg'), 'rtl');
    dom.window.close();
  });

  await test('dynamically inserted message is processed automatically', async () => {
    const dom = makeDom('<div id="root"></div>');
    await wait(80);
    const p = dom.window.document.createElement('p');
    p.id = 'late';
    p.textContent = 'سلام، این پیام بعداً اضافه شد';
    dom.window.document.getElementById('root').appendChild(p);
    await wait(120);
    assert.strictEqual(dirOf(dom, '#late'), 'rtl');
    dom.window.close();
  });

  await test('English paragraph inside Persian answer gets explicit ltr', async () => {
    const dom = makeDom(
      '<div class="markdown"><p>پاسخ فارسی است.</p><p id="en">This paragraph is English.</p></div>'
    );
    await wait(80);
    assert.strictEqual(dirOf(dom, '#en'), 'ltr');
    dom.window.close();
  });

  /* ---------------- Inputs ---------------- */
  await test('text inputs and textareas get dir=auto', async () => {
    const dom = makeDom('<form><input id="i" type="text"><textarea id="t"></textarea><input id="c" type="checkbox"></form>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '#i'), 'auto');
    assert.strictEqual(dirOf(dom, '#t'), 'auto');
    assert.strictEqual(dirOf(dom, '#c'), null);
    dom.window.close();
  });

  await test('contenteditable chat composer follows Persian/English and restores on disable', async () => {
    const dom = makeDom(
      '<div class="composer">' +
      '<div class="composer-input" id="composer" contenteditable="true" data-composer-input=""></div>' +
      '</div>'
    );
    await wait(80);
    const composer = dom.window.document.getElementById('composer');
    assert.strictEqual(dirOf(dom, '#composer'), 'auto', 'empty composer should start with dir=auto');

    composer.innerHTML = '<span id="inner">سلام دنیا، این یک پیام فارسی است</span>';
    await wait(120);
    assert.strictEqual(dirOf(dom, '#composer'), 'rtl');
    assert.strictEqual(markedDirOf(dom, '#composer'), 'rtl');
    assert.strictEqual(markedDirOf(dom, '#inner'), null, 'inner composer lines must not be directioned separately');

    composer.textContent = 'Hello world, this draft is English';
    await wait(120);
    assert.strictEqual(dirOf(dom, '#composer'), 'ltr');

    dom.window.RTLUniversal.disable();
    assert.strictEqual(dirOf(dom, '#composer'), null);
    dom.window.close();
  });

  await test('matching author-provided explicit dir is respected in smart mode', async () => {
    const dom = makeDom('<div class="markdown"><p id="x" dir="ltr">This paragraph is English and author-marked LTR.</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '#x'), 'ltr');
    assert.strictEqual(dom.window.document.getElementById('x').hasAttribute('data-rtl-dir'), false);
    dom.window.close();
  });

  await test('smart mode corrects a contradictory explicit dir and restores it on disable', async () => {
    const dom = makeDom('<div class="markdown"><p id="x" dir="ltr">سلام دنیا، این یک پیام فارسی است.</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '#x'), 'rtl');
    assert.strictEqual(dom.window.document.getElementById('x').getAttribute('data-rtl-orig-dir'), 'ltr');
    dom.window.RTLUniversal.disable();
    assert.strictEqual(dirOf(dom, '#x'), 'ltr');
    dom.window.close();
  });

  await test('smart mode corrects dir=auto from actual Persian text and restores it on disable', async () => {
    const dom = makeDom('<div class="markdown"><p id="x" dir="auto">سلام دنیا، این یک پیام فارسی است.</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '#x'), 'rtl');
    assert.strictEqual(dom.window.document.getElementById('x').getAttribute('data-rtl-orig-dir'), 'auto');
    dom.window.RTLUniversal.disable();
    assert.strictEqual(dirOf(dom, '#x'), 'auto');
    dom.window.close();
  });

  /* ---------------- Monaco chat composer ---------------- */
  await test('Monaco chat composer is marked RTL when Persian is typed', async () => {
    const dom = makeDom(
      '<div class="interactive-input-part">' +
      '<div class="monaco-editor" id="mono"><div class="view-lines"><div class="view-line"><span>سلام دنیا</span></div></div></div>' +
      '</div>'
    );
    await wait(150);
    assert.ok(dom.window.document.getElementById('mono').classList.contains('rtl-universal-input-rtl'));
    dom.window.close();
  });

  await test('Monaco editor in terminal/panel context is NOT touched', async () => {
    const dom = makeDom(
      '<div class="terminal-panel">' +
      '<div class="monaco-editor" id="mono2"><div class="view-lines"><div class="view-line"><span>echo سلام</span></div></div></div>' +
      '</div>'
    );
    await wait(150);
    assert.ok(!dom.window.document.getElementById('mono2').classList.contains('rtl-universal-input-rtl'));
    dom.window.close();
  });

  /* ---------------- Modes & lifecycle ---------------- */
  await test('mode "rtl" overrides an explicit page dir and restores it on disable', async () => {
    const dom = makeDom('<div class="markdown" id="container" dir="ltr"><p>English only text here</p></div>', { mode: 'rtl' });
    await wait(80);
    assert.strictEqual(dirOf(dom, '#container'), 'rtl');
    assert.strictEqual(dom.window.document.getElementById('container').getAttribute('data-rtl-orig-dir'), 'ltr');
    dom.window.RTLUniversal.disable();
    assert.strictEqual(dirOf(dom, '#container'), 'ltr');
    dom.window.close();
  });

  await test('mode "ltr" overrides an explicit page dir', async () => {
    const dom = makeDom('<div class="markdown" id="container" dir="rtl"><p>متن فارسی</p></div>', { mode: 'ltr' });
    await wait(80);
    assert.strictEqual(dirOf(dom, '#container'), 'ltr');
    assert.strictEqual(dom.window.document.getElementById('container').getAttribute('data-rtl-orig-dir'), 'rtl');
    dom.window.close();
  });

  await test('deferred start waits for browser-extension settings before touching a page', async () => {
    const dom = new JSDOM(
      '<!doctype html><html><head></head><body><div class="markdown"><p id="wait">سلام دنیا</p></div></body></html>',
      { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://chatgpt.com/' }
    );
    dom.window.__RTL_UNIVERSAL_DEFER_START__ = true;
    dom.window.__RTL_UNIVERSAL_CONFIG__ = { enabled: false, mode: 'smart' };
    dom.window.eval(ENGINE_SRC);
    await wait(40);
    assert.ok(dom.window.RTLUniversal, 'control API should exist before start');
    assert.strictEqual(dirOf(dom, '#wait'), null, 'the deferred engine must leave the page untouched');
    assert.strictEqual(dom.window.document.getElementById('rtl-universal-style'), null);
    dom.window.RTLUniversal.enable();
    await wait(90);
    assert.strictEqual(dirOf(dom, '#wait'), 'rtl', 'enable() should start the engine after preferences load');
    dom.window.close();
  });

  await test('disable() restores original attributes', async () => {
    const dom = makeDom('<div class="markdown"><p id="p1">سلام دنیا</p></div>');
    await wait(80);
    assert.strictEqual(dirOf(dom, '#p1'), 'rtl');
    dom.window.RTLUniversal.disable();
    assert.strictEqual(dirOf(dom, '#p1'), null);
    assert.strictEqual(markedDirOf(dom, '#p1'), null);
    dom.window.close();
  });

  await test('invalid selectors in config do not crash the engine', async () => {
    const dom = makeDom('<div class="markdown"><p>سلام دنیا</p></div>', { containerSelector: 'not-a-real-[selector' });
    await wait(80);
    assert.ok(dom.window.RTLUniversal);
    dom.window.close();
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    failures.forEach((f) => console.error('FAILED: ' + f.name + '\n' + f.error.stack + '\n'));
    process.exit(1);
  }
})();
