#!/usr/bin/env node
/**
 * Builds distribution assets from the single engine source:
 *   release/rtl-universal.user.js   — userscript (Tampermonkey / Violentmonkey)
 *   release/bookmarklet.txt         — javascript: bookmarklet
 *   release/console-snippet.js      — paste into DevTools console
 *   demo/index.html                 — self-contained interactive demo
 * Run: node scripts/build-assets.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENGINE_PATH = path.join(ROOT, 'src', 'engine', 'rtl-engine.js');
const DIST = path.join(ROOT, 'release');

const VERSION = require('../package.json').version;
const PRODUCT_NAME = `CyrusAsha_UniversalRTL-${VERSION}`;

/* ============================================================================
 * این اسکریپت چه می‌کند؟
 * ----------------------------------------------------------------------------
 * از «یک» فایل موتور (src/engine/rtl-engine.js) چند خروجی می‌سازد:
 *   - یوزراسکریپت برای Tampermonkey   (release/rtl-universal.user.js)
 *   - اسنیپت کنسول برای تست سریع      (release/console-snippet.js)
 *   - بوکمارکلت (لینک جاوااسکریپتی)   (release/bookmarklet.txt)
 *   - دموی خودکفا                     (demo/index.html)
 *
 * MATCHES فهرست سایت‌هایی است که یوزراسکریپت در آن‌ها اجرا می‌شود.
 * برای افزودن سایت جدید، فقط یک آدرس اینجا اضافه کن و npm run build:assets بزن.
 * ========================================================================== */
const MATCHES = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
  'https://aistudio.google.com/*',
  'https://chat.deepseek.com/*',
  'https://www.perplexity.ai/*',
  'https://chat.qwen.ai/*',
  'https://grok.com/*',
  'https://x.com/i/grok*',
  'https://you.com/*',
  'https://copilot.microsoft.com/*',
  'https://poe.com/*',
  'https://kimi.moonshot.cn/*',
  'https://www.kimi.com/*',
  'https://chat.mistral.ai/*',
  'https://chatglm.cn/*',
  'https://yuanbao.tencent.com/*',
  'https://tongyi.aliyun.com/*',
  'https://chat.lmsys.org/*',
  'https://openrouter.ai/chat*',
  'https://character.ai/*',
  'https://chatgpt.com/**',
  'https://www.doubao.com/*',
  'https://chat.minimax.io/*'
];

function readEngine() { return fs.readFileSync(ENGINE_PATH, 'utf8'); }

function configBlock(cfg) {
  return 'window.__RTL_UNIVERSAL_CONFIG__ = ' + JSON.stringify(cfg) + ';\n';
}

/* بخش «هدر» یوزراسکریپت توسط مدیر افزونه (Tampermonkey/Violentmonkey)
 * خوانده می‌شود؛ نام، نسخه و سایت‌های مجاز از همان‌جا می‌آید. */
function buildUserscript() {
  const header = [
    '// ==UserScript==',
    '// @name         ' + PRODUCT_NAME + ' — راست‌چین هوشمند چت‌های هوش مصنوعی',
    '// @name:en      ' + PRODUCT_NAME + ' — Smart RTL for AI Chats',
    '// @namespace    https://github.com/rtl-universal',
    '// @version      ' + VERSION,
    '// @description  تشخیص هوشمند جهت پیام‌ها (فارسی/عربی/عبری) در ChatGPT، Claude، Gemini، DeepSeek، Qwen، Grok، Perplexity و… — کدها و ترمینال LTR می‌مانند.',
    '// @author       CyrusAsha',
    '// @license      MIT',
    ...MATCHES.map((m) => '// @match        ' + m),
    '// @run-at       document-start',
    '// @grant        none',
    '// ==/UserScript==',
    ''
  ].join('\n');

  const body = configBlock({ mode: 'smart', inputs: true, monacoChatInput: true }) + readEngine();
  const out = path.join(DIST, 'rtl-universal.user.js');
  fs.writeFileSync(out, header + body, 'utf8');
  return out;
}

function buildConsoleSnippet() {
  const out = path.join(DIST, 'console-snippet.js');
  const comment = [
    '/* ' + PRODUCT_NAME + ' — برای تست موقت:',
    '   این فایل را در کنسول DevTools (F12) اپ یا مرورگر Paste کن.',
    '   فقط تا بستن برنامه اثر دارد. */',
    ''
  ].join('\n');
  fs.writeFileSync(out, comment + configBlock({ mode: 'smart' }) + readEngine(), 'utf8');
  return out;
}

/* کوچک‌سازی محافظه‌کارانه برای بوکمارکلت:
 * بوکمارکلت باید در یک URL جا شود؛ پس کامنت‌ها و فاصله‌های اضافه حذف می‌شوند.
 * (فشرده‌سازی پیشرفته عمداً انجام نمی‌شود تا کد قابل خواندن بماند.) */
function minifyForBookmarklet(source) {
  // Conservative minification: strip block comments and squeeze whitespace.
  return source
    .replace(/\/\*\[!][\s\S]*?\*\//, '')     // license banner
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function buildBookmarklet() {
  const code = configBlock({ mode: 'smart' }) + minifyForBookmarklet(readEngine());
  const out = path.join(DIST, 'bookmarklet.txt');
  const bookmarklet = 'javascript:' + encodeURIComponent(code);
  fs.writeFileSync(out, bookmarklet + '\n', 'utf8');
  return { out, length: bookmarklet.length };
}

/* دمو: قالب HTML را می‌خواند و موتور واقعی را جای نشانه‌ی __RTL_ENGINE__ می‌گذارد.
 * نتیجه یک فایل تک‌فایلی است که بدون اینترنت هم کار می‌کند. */
function buildDemo() {
  const templatePath = path.join(ROOT, 'demo', 'demo.template.html');
  const out = path.join(ROOT, 'demo', 'index.html');
  let html = fs.readFileSync(templatePath, 'utf8');
  const engine = configBlock({ mode: 'smart', inputs: true, monacoChatInput: true }) + readEngine();
  if (!html.includes('/*__RTL_ENGINE__*/')) throw new Error('demo template is missing the engine placeholder');
  html = html.replace('/*__RTL_ENGINE__*/', () => engine);
  fs.writeFileSync(out, html, 'utf8');
  return out;
}

function main() {
  fs.mkdirSync(DIST, { recursive: true });
  const user = buildUserscript();
  const consoleSnippet = buildConsoleSnippet();
  const bm = buildBookmarklet();
  const demo = buildDemo();
  console.log('✅ release/' + path.basename(user));
  console.log('✅ release/' + path.basename(consoleSnippet));
  console.log('✅ release/bookmarklet.txt (' + (bm.length / 1024).toFixed(1) + ' KB)');
  console.log('✅ demo/index.html (self-contained)');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('❌ ' + e.message); process.exit(1); }
}
module.exports = { main };
