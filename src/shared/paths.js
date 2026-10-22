/**
 * paths.js — پیدا کردن فایل‌های پروژه، در هر جایی که اجرا شود
 * ============================================================================
 * چرا این فایل لازم است؟
 * ----------------------------------------------------------------------------
 * برنامه‌ی ما در سه حالت مختلف اجرا می‌شود و در هر حالت «پوشه‌ی ریشه‌ی پروژه»
 * جای متفاوتی است:
 *
 *   ۱. اجرای معمولی:      node src/gui/server.js        → ریشه = پوشه‌ی مخزن
 *   ۲. اجرای CLI پچر:     node src/patcher/patch-electron.js → همان بالا
 *   ۳. فایل اجرایی ویندوزی (CyrusAsha_UniversalRTL-1.0.0.exe):
 *        کد داخل خود exe بسته‌بندی شده است، پس __dirname دیگر به سورس‌ها
 *        اشاره نمی‌کند. ریشه = پوشه‌ای که exe در آن قرار دارد.
 *
 * این ماژول یک راه یکسان برای پیدا کردن فایل‌ها می‌دهد: از محل کد شروع
 * می‌کند، پوشه‌های والد را یکی‌یکی امتحان می‌کند و همچنین پوشه‌ی exe را
 * بررسی می‌کند. اولین جایی که فایل مورد نظر را داشت، ریشه است.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

/* نام فایلی که «نشانه‌ی ریشه» است: اگر پیدا شد، یعنی این پوشه ریشه‌ی پروژه است. */
const MARKER = path.join('src', 'engine', 'rtl-engine.js');

/**
 * فهرست پوشه‌هایی که ممکن است ریشه باشند، به ترتیب اولویت.
 * - اگر کسی global.__RTL_ROOT__ را ست کرده باشد (تست/AI/Custom)، اول همان.
 * - سپس از محل این فایل به بالا می‌رویم (حالت عادی repo).
 * - سپس پوشه‌ی exe و والدش (حالت portable / SEA).
 * @returns {string[]}
 */
function candidateRoots() {
  const roots = [];
  const seen = new Set();
  const add = (p) => {
    if (!p) return;
    const resolved = path.resolve(p);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    roots.push(resolved);
  };

  if (typeof global !== 'undefined' && global.__RTL_ROOT__) add(global.__RTL_ROOT__);

  // بالا رفتن از محل این فایل (src/shared/paths.js → src/shared → src → ریشه)
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    add(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // حالت فایل اجرایی / portable
  try {
    const exeDir = path.dirname(process.execPath);
    add(exeDir);
    add(path.join(exeDir, '..'));
  } catch (e) { /* ignore */ }

  return roots;
}

/**
 * پوشه‌ی ریشه‌ی پروژه را برمی‌گرداند.
 * @returns {string} مسیری که فایل src/engine/rtl-engine.js داخلش هست
 *                   (اگر هیچ‌کدام نبود، بهترین حدس: دو پله بالاتر از این فایل)
 */
function projectRoot() {
  for (const root of candidateRoots()) {
    try {
      if (fs.existsSync(path.join(root, MARKER))) return root;
    } catch (e) { /* ignore */ }
  }
  return path.resolve(__dirname, '..', '..');
}

/**
 * یک فایل پروژه را با مسیر نسبی پیدا می‌کند.
 * @param {string} relPath مثل 'src/engine/rtl-engine.js'
 * @returns {string|null} مسیر کامل یا null اگر نبود
 */
function findAsset(relPath) {
  for (const root of candidateRoots()) {
    const full = path.join(root, relPath);
    try {
      if (fs.existsSync(full)) return full;
    } catch (e) { /* ignore */ }
  }
  return null;
}

/**
 * آیا برنامه به‌صورت فایل اجرایی تک‌فایلی (SEA / pkg) اجرا شده است؟
 * Node.js 20+ یک API رسمی به نام node:sea دارد؛ اگر نبود، حدس می‌زنیم:
 * اگر پوشه‌ی ریشه شامل فایل src نباشد ولی exe وجود داشته باشد → SEA.
 */
function isStandalone() {
  try {
    // eslint-disable-next-line node/no-unsupported-features/node-builtins
    const sea = require('node:sea');
    if (sea && typeof sea.isSea === 'function') return sea.isSea();
  } catch (e) { /* Node < 20 یا اجرای معمولی */ }
  return path.resolve(process.execPath) !== path.resolve(process.argv[1] || '');
}

module.exports = { projectRoot, findAsset, candidateRoots, isStandalone, MARKER };
