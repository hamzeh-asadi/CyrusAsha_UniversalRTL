#!/usr/bin/env node
/**
 * CyrusAsha_UniversalRTL-1.0.0 — Electron patcher (Windows / macOS / Linux)
 *
 * Injects the CyrusAsha_UniversalRTL-1.0.0 engine into a standalone Electron app (e.g. Hermes,
 * Freebuff, OpenCode desktop, Claude Desktop, ChatGPT Desktop, Cursor…).
 *
 * Usage (Windows PowerShell / CMD):
 *   node patch-electron.js                     تعاملی: برنامه‌ها را پیدا کن و انتخاب کن
 *   node patch-electron.js --list              فقط فهرست برنامه‌های پیدا‌شده
 *   node patch-electron.js --app "C:\Path\App.exe"
 *   node patch-electron.js --app "C:\Path\App.exe" --dry-run
 *   node patch-electron.js --app "C:\Path\App.exe" --unpatch
 *   node patch-electron.js --app "..." --mode rtl --css "body{font-family:Vazirmatn}"
 *   node patch-electron.js --status --app "..."
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const asar = require('./asar');
const { findAsset } = require('../shared/paths');

/* مسیر موتور را «قابل‌حمل» پیدا می‌کنیم: در مخزن کنار همین فایل است،
 * در حالت فایل اجرایی ویندوزی (exe) کنار خود exe. */
const ENGINE_PATH = findAsset(path.join('src', 'engine', 'rtl-engine.js')) ||
  path.join(__dirname, '..', 'engine', 'rtl-engine.js');

/* نام فایل‌های تزریقی داخل app.asar. اگر این نام‌ها را عوض کنی،
 * HOOK_SOURCE و injectSnippet هم باید هماهنگ شوند.
 *
 * هُک عمداً .cjs است، نه .js: بعضی اپ‌ها (مثل Freebuff) در package.json خود
 * «type": "module"» دارند و Electron 33 هنوز Node 20 است. در آن حالت Node
 * هر فایل .js را ESM می‌داند و require() با ERR_REQUIRE_ESM شکست می‌خورد؛
 * هُک ما CommonJS است و باید پسوند .cjs داشته باشد تا در هر دو نوع بسته
 * به‌عنوان CommonJS بارگذاری شود. */
const HOOK_FILE = 'rtl-universal.cjs';
const LEGACY_HOOK_FILE = 'rtl-universal.js';
const ENGINE_FILE = 'rtl-universal-engine.js';
const CONFIG_FILE = 'rtl-universal.config.json';
const CSS_FILE = 'rtl-universal.css';
const INJECTED_FILE = 'rtl-universal.injected.json';
const MARKER = '/*rtl-universal-hook*/';
const BACKUP_SUFFIX = '.rtl-backup';

/* ============================================================================
 * مفاهیم لازم قبل از خواندن این فایل
 * ----------------------------------------------------------------------------
 * Electron: چارچوب ساخت اپ دسکتاپ با HTML/JS. هر اپ Electron دو «دنیا» دارد:
 *   - Main process  : کد Node.js که پنجره‌ها را می‌سازد (فایل package.json → main)
 *   - Renderer      : خود صفحه‌ی وب داخل پنجره
 *
 * برای راست‌چین‌کردن، باید موتور ما داخل هر صفحه تزریق شود. راه امن:
 *   ۱. app.asar را باز می‌کنیم؛
 *   ۲. یک فایل کوچک (rtl-universal.cjs) داخلش می‌گذاریم که به رویداد
 *      «web-contents-created» گوش می‌دهد و موتور را در هر صفحه اجرا می‌کند؛
 *   ۳. یک خط require برای آن فایل به main process اضافه می‌کنیم؛
 *   ۴. دوباره بسته‌بندی می‌کنیم.
 *
 * نام‌های ثابت زیر همان فایل‌هایی هستند که داخل asar نوشته می‌شوند.
 * ========================================================================== */
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'coverage', '__pycache__']);
const SCRIPT_EXTS = new Set(['.js', '.cjs']);

/* ------------------------------------------------------------------ *
 * Hook runtime (written into the app's asar, executed in main process)
 * ------------------------------------------------------------------ */
/* ============================================================================
 * HOOK_SOURCE — کدی که داخل main process اجرا می‌شود
 * ----------------------------------------------------------------------------
 * چرا داخل «رشته» است؟ چون این کد قرار نیست همین‌جا اجرا شود؛ باید به‌صورت
 * یک فایل متنی داخل آرشیو برنامه‌ی مقصد نوشته شود و آنجا اجرا شود.
 *
 * چه می‌کند؟
 *   - به app.on('web-contents-created') گوش می‌دهد (هر پنجره/تب جدید)
 *   - در رویدادهای dom-ready و did-finish-load، موتور را ابتدا با
 *     contents.executeJavaScript(...) در صفحه تزریق می‌کند
 *   - پیکربندی (حالت/فونت) را هم همراه موتور می‌فرستد
 *   - اگر CSP اجرای صفحه‌ی اصلی را رد کند، در یک isolated world اختصاصی تلاش می‌کند؛
 *     سیاست CSP برنامه را تغییر نمی‌دهد و unsafe-eval اضافه نمی‌کند
 *   - گزارش runtime فقط با opt-in و فقط شامل نسخه/وضعیت/شمارنده‌هاست؛ متن گفتگو را نمی‌خواند
 * ========================================================================== */
const HOOK_SOURCE = `/* CyrusAsha_UniversalRTL-1.0.0 runtime hook v3 (https://github.com/rtl-universal) */
(function () {
  'use strict';
  var electron = null;
  try { electron = require('electron'); } catch (e) { return; }
  var app = electron && electron.app;
  if (!app || typeof app.whenReady !== 'function') return;
  if (app.__rtlUniversalHooked) return;
  app.__rtlUniversalHooked = true;

  var fs = require('fs');
  var path = require('path');
  var base = __dirname;
  var engineSource = null;
  var diagnostics = false;
  try { diagnostics = process.env.RTL_UNIVERSAL_DIAGNOSTICS === '1'; } catch (e) {}
  var diagnosticPath = null;

  /* نام فایل «درخواست گزارش»: اگر این فایل در پوشه‌ی TEMP ساخته شود، همین
   * پروسه‌ی در حال اجرا بدون بستن برنامه یک گزارش تازه می‌نویسد. */
  var TRIGGER_FILE = 'CyrusAsha_UniversalRTL-dump-request.json';
  var HOOK_VERSION = 'hook/3';
  function versionString() { return HOOK_VERSION; }
  function tempDir() {
    try { return process.env.TEMP || process.env.TMP || process.cwd(); } catch (e) { return process.cwd(); }
  }
  function defaultDiagnosticPath() {
    return path.join(tempDir(), 'CyrusAsha_UniversalRTL-Freebuff-runtime.jsonl');
  }
  function triggerPath() { return path.join(tempDir(), TRIGGER_FILE); }

  /* گزارش را روشن می‌کند (چه با متغیر محیطی، چه با درخواست فایل) و فایل را خالی می‌کند. */
  function enableDiagnostics() {
    diagnostics = true;
    if (!diagnosticPath) {
      try {
        diagnosticPath = process.env.RTL_UNIVERSAL_DIAGNOSTICS_PATH || defaultDiagnosticPath();
      } catch (e) { diagnosticPath = null; }
    }
    if (!diagnosticPath) return false;
    try { fs.writeFileSync(diagnosticPath, '', 'utf8'); return true; } catch (e) { return false; }
  }

  if (diagnostics) enableDiagnostics();

  function diag(event, contents, details) {
    if (!diagnostics || !diagnosticPath) return;
    try {
      var record = {
        time: new Date().toISOString(),
        event: event,
        pid: process.pid,
        electron: process.versions && process.versions.electron || null
      };
      try { record.appVersion = app.getVersion(); } catch (e) { record.appVersion = null; }
      if (contents) {
        record.webContentsId = typeof contents.id === 'number' ? contents.id : null;
        try { record.webContentsType = contents.getType(); } catch (e) { record.webContentsType = null; }
      }
      if (details) record.details = details;
      try {
        if (fs.existsSync(diagnosticPath) && fs.statSync(diagnosticPath).size > 524288) {
          fs.writeFileSync(diagnosticPath, '', 'utf8');
        }
        fs.appendFileSync(diagnosticPath, JSON.stringify(record) + String.fromCharCode(10), 'utf8');
      } catch (e) {}
    } catch (e) {}
  }

  function errorClass(error) {
    var message = '';
    try { message = String(error && (error.message || error)); } catch (e) {}
    return {
      name: error && error.name ? String(error.name) : 'Error',
      category: /content.?security.?policy|unsafe-eval|evalerror|script-src/i.test(message) ? 'csp' : 'other'
    };
  }

  /* فقط مقدارهای کوچک و بدون‌متن از نتیجه‌ی صفحه جدا می‌شوند تا لاگ هرگز
   * محتوای گفتگو را نگیرد (شمارنده، نام کلاس و طول متن مجاز است). */
  function summarize(result) {
    if (result && typeof result === 'object') {
      var out = {};
      var keys = Object.keys(result).slice(0, 14);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = result[key];
        if (typeof value === 'string') out[key] = value.slice(0, 200);
        else if (value === null || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
        else if (typeof value === 'object') out[key] = value;
      }
      return out;
    }
    return { loaded: result === true, version: null, mode: null, proseCount: 0, rtlCount: 0, stats: null };
  }

  /* گزارش شمارشی صفحه: چند ظرف پیام وجود دارد، چند تایشان dir گرفتند و
   * موتور چه تصمیمی گرفت — بدون هیچ کاراکتری از متن گفتگو. */
  function censusCode() {
    return ';(function(){try{var r=window.RTLUniversal;if(!r)return{loaded:false};' +
      'var p=document.querySelectorAll(".prose");var q=document.querySelectorAll(".prose[data-rtl-dir=rtl]");' +
      'var c=r.census?r.census():{};c.loaded=true;c.version=r.version||null;c.mode=r.config&&r.config.mode||null;' +
      'c.proseCount=p.length;c.rtlCount=q.length;c.title=String(document.title||"").slice(0,80);' +
      'c.href=String(location.href||"").slice(0,120);return c;}catch(e){return{loaded:false,error:String(e&&e.message||e)}}})()';
  }

  diag('hook-loaded', null, { diagnostics: diagnostics });

  function readIfExists(name) {
    try {
      var p = path.join(base, name);
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    } catch (e) {}
    return null;
  }

  var config = null;
  try { config = JSON.parse(readIfExists('${CONFIG_FILE}') || 'null'); } catch (e) { config = null; }
  var extraCss = readIfExists('${CSS_FILE}') || '';
  engineSource = readIfExists('${ENGINE_FILE}');
  if (!engineSource) { diag('engine-missing', null); return; }

  function buildCode() {
    var cfg = {};
    if (config && typeof config === 'object') { for (var k in config) cfg[k] = config[k]; }
    if (extraCss) cfg.extraCSS = (cfg.extraCSS ? cfg.extraCSS + String.fromCharCode(10) : '') + extraCss;
    var code = 'window.__RTL_UNIVERSAL_CONFIG__ = ' + JSON.stringify(cfg) + ';' + String.fromCharCode(10) + engineSource;
    if (!diagnostics) return code + String.fromCharCode(10) + ';!!(window.RTLUniversal && window.RTLUniversal.version)';
    return code + String.fromCharCode(10) + censusCode();
  }

  function injectIsolated(contents, code, reason, event) {
    var eventName = event || 'isolated-world-result';
    try {
      if (!contents || contents.isDestroyed && contents.isDestroyed()) return;
      if (typeof contents.executeJavaScriptInIsolatedWorld !== 'function') {
        diag('isolated-world-unavailable', contents, { reason: reason });
        return;
      }
      var result = contents.executeJavaScriptInIsolatedWorld(98765, [{ code: code }], true);
      Promise.resolve(result).then(function (value) {
        diag(eventName, contents, { world: 'isolated', reason: reason, status: summarize(value) });
      }).catch(function (error) {
        diag('isolated-world-error', contents, { reason: reason, error: errorClass(error) });
      });
    } catch (error) {
      diag('isolated-world-error', contents, { reason: reason, error: errorClass(error) });
    }
  }

  /* یک گزارش تازه از پنجره‌ی در حال اجرا — بدون بستن برنامه و بدون DevTools. */
  function report(contents) {
    try {
      if (!contents || contents.isDestroyed && contents.isDestroyed()) return;
      var type = '';
      try { type = contents.getType(); } catch (e) {}
      if (type === 'remote') return;
      var code = censusCode();
      Promise.resolve(contents.executeJavaScript(code, true)).then(function (value) {
        var status = summarize(value);
        diag('renderer-report', contents, { world: 'main', status: status });
        if (!status.loaded) injectIsolated(contents, code, 'report:main-world-marker-missing', 'renderer-report');
      }).catch(function (error) {
        diag('renderer-report-error', contents, { world: 'main', error: errorClass(error) });
        injectIsolated(contents, code, 'report:main-world-failed', 'renderer-report');
      });
    } catch (error) {
      diag('renderer-report-error', null, errorClass(error));
    }
  }

  function dumpNow() {
    if (!enableDiagnostics()) return;
    diag('dump-request', null, { trigger: TRIGGER_FILE, version: versionString() });
    var list = [];
    try { list = electron.webContents.getAllWebContents(); } catch (e) { list = []; }
    for (var i = 0; i < list.length; i++) report(list[i]);
    diag('dump-finished', null, { renderers: list.length });
  }

  function pollTrigger() {
    try {
      var file = triggerPath();
      if (!fs.existsSync(file)) return;
      try { fs.rmSync(file, { force: true }); } catch (e) {}
      dumpNow();
    } catch (e) {}
  }

  function injectInto(contents) {
    try {
      if (!contents || contents.isDestroyed && contents.isDestroyed()) return;
      var type = '';
      try { type = contents.getType(); } catch (e) {}
      if (type === 'remote') { diag('renderer-skipped', contents, { reason: 'remote' }); return; }
      var code = buildCode();
      diag('renderer-inject-start', contents, { world: 'main' });
      Promise.resolve(contents.executeJavaScript(code, true)).then(function (value) {
        var status = summarize(value);
        diag('renderer-inject-result', contents, { world: 'main', status: status });
        if (!status.loaded) injectIsolated(contents, code, 'main-world-marker-missing');
      }).catch(function (error) {
        var classified = errorClass(error);
        diag('renderer-inject-error', contents, { world: 'main', error: classified });
        if (classified.category === 'csp') injectIsolated(contents, code, 'main-world-csp-rejection');
      });
    } catch (error) {
      var classified = errorClass(error);
      diag('renderer-inject-error', contents, { world: 'main', error: classified });
      if (classified.category === 'csp') injectIsolated(contents, buildCode(), 'main-world-csp-rejection');
    }
  }

  function attach(contents) {
    try {
      if (!contents || contents.__rtlUniversalAttached) return;
      contents.__rtlUniversalAttached = true;
      contents.on('dom-ready', function () { injectInto(contents); });
      contents.on('did-finish-load', function () { injectInto(contents); });
      diag('web-contents-attached', contents);
    } catch (e) {}
  }

  try {
    app.on('web-contents-created', function (_event, contents) { attach(contents); });
  } catch (e) {}
  try {
    app.whenReady().then(function () {
      try {
        electron.webContents.getAllWebContents().forEach(attach);
      } catch (e) { diag('enumerate-web-contents-error', null, errorClass(e)); }
      pollTrigger();
    });
  } catch (e) { diag('when-ready-error', null, errorClass(e)); }

  /* درخواست گزارش زنده: فایل trigger در TEMP هر دو ثانیه بررسی می‌شود.
   * این کار صفحه را تغییر نمی‌دهد؛ فقط می‌خواند و یک گزارش بدون‌متن می‌نویسد. */
  try {
    var pollMs = Number(process.env.RTL_UNIVERSAL_TRIGGER_INTERVAL) || 2000;
    if (typeof setInterval === 'function') setInterval(pollTrigger, pollMs);
  } catch (e) {}
})();
`;

/* آن یک خطی که به main process برنامه اضافه می‌شود.
 * چرا حلقه‌ی جستجو؟ چون فایل main می‌تواند در ریشه‌ی asar یا در زیرپوشه باشد
 * (مثلاً out/main.js). تا ۷ سطح بالا می‌رویم تا rtl-universal.cjs را پیدا کنیم.
 * اگر پیدا نشد، از process.resourcesPath هم تلاش می‌کنیم. نام قدیمی .js هم
 * برای سازگاری با پچ‌های قبلی بررسی می‌شود، اما فایل تازه همیشه .cjs است.
 *
 * try/catch همه‌جا هست تا اگر چیزی شکست خورد، برنامه‌ی اصلی همچنان اجرا شود. */
function injectSnippet() {
  // Finds rtl-universal.cjs (or a legacy rtl-universal.js) from any depth inside
  // the asar, then from resourcesPath. .cjs is tried first so an ESM-typed app
  // never feeds the CommonJS hook to Node's ESM loader.
  return MARKER + ';(function(){try{' +
    "var p=require('path'),fs=require('fs'),b=__dirname,f,i,n,names=['" + HOOK_FILE + "','" + LEGACY_HOOK_FILE + "'];" +
    "for(i=0;i<7;i++){for(n=0;n<names.length;n++){try{f=p.join(b,names[n]);if(fs.existsSync(f)){require(f);return;}}catch(e){}}b=p.join(b,'..');}" +
    "try{for(n=0;n<names.length;n++){f=p.join(process.resourcesPath||'','app.asar',names[n]);if(fs.existsSync(f)){require(f);return;}}}catch(e){}" +
    '}catch(e){}})();\n';
}

/* ------------------------------------------------------------------ *
 * App detection
 * ------------------------------------------------------------------ */
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }

/**
 * خطاهای فایل را به پیام قابل‌فهم (دوزبانه) تبدیل می‌کند.
 * مهم‌ترین حالت‌ها در ویندوز:
 *   EBUSY  → فایل توسط برنامه‌ی باز قفل شده
 *   EPERM  → اجازه‌ی سیستم یا آنتی‌ویروس
 *   EACCES → پوشه فقط-خواندنی است (مثلاً Program Files بدون Administrator)
 */
function friendlyFsError(e) {
  const code = (e && e.code) || '';
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    return {
      error: 'فایل app.asar قفل است یا اجازه‌ی نوشتن نداریم (' + code + ').\n' +
        'برنامه را کاملاً ببند (از Task Manager هم مطمئن شو) و اگر در Program Files نصب است، ' +
        'پچر را با دسترسی Administrator اجرا کن.',
      errorEn: 'app.asar is locked or not writable (' + code + ').\n' +
        'Close the app completely (check Task Manager) and, if it is installed under Program Files, ' +
        'run the patcher as Administrator.'
    };
  }
  if (code === 'ENOSPC') {
    return {
      error: 'فضای دیسک کافی نیست (' + code + ').',
      errorEn: 'Not enough disk space (' + code + ').'
    };
  }
  return {
    error: 'خطا هنگام پچ: ' + (e && e.message),
    errorEn: 'Error while patching: ' + (e && e.message)
  };
}
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

/* ============================================================================
 * تشخیص برنامه‌ها
 * ----------------------------------------------------------------------------
 * هدف: پیدا کردن پوشه‌هایی که ساختار <App>/resources/app.asar دارند.
 * مسیرهای استاندارد هر سیستم‌عامل:
 *   ویندوز: %LOCALAPPDATA%\Programs، Program Files، Program Files (x86)
 *   مک   : /Applications/*.app/Contents/Resources/app.asar
 *   لینوکس: /opt، /usr/lib، /usr/share، ~/.local/share، /snap
 * ========================================================================== */
function manifestInfo(asarPath) {
  const m = asar.readManifest(asarPath);
  if (!m) return { name: null, version: null };
  return {
    name: m.productName || m.name || null,
    version: m.version || null,
    main: m.main || null
  };
}

function candidateFromAppRoot(appRoot, asarPath, launcher) {
  const info = manifestInfo(asarPath);
  return {
    appRoot,
    asar: asarPath,
    launcher: launcher || null,
    name: info.name || path.basename(appRoot),
    version: info.version,
    main: info.main
  };
}

/* جستجوی اپ‌ها در ویندوز.
 * منطق: در هر پوشه‌ی پایه، پوشه‌های سطح-اول و سطح-دوم را بررسی می‌کنیم
 * (چون بعضی برنامه‌ها مستقیم‌اند و بعضی داخل پوشه‌ی سازنده نصب می‌شوند).
 * با Set از تکرار جلوگیری می‌کنیم. */
function findWindowsApps() {
  const out = [];
  const localAppData = process.env.LOCALAPPDATA;
  const bases = [
    localAppData ? path.join(localAppData, 'Programs') : null,
    localAppData,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramW6432
  ].filter(Boolean);

  const seen = new Set();
  const push = (appRoot, exe) => {
    const asarPath = path.join(appRoot, 'resources', 'app.asar');
    if (!isFile(asarPath)) return;
    const key = path.resolve(asarPath).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidateFromAppRoot(appRoot, asarPath, exe));
  };

  for (const base of bases) {
    if (!isDir(base)) continue;
    if (isFile(path.join(base, 'resources', 'app.asar'))) push(base, null);
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (e) { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dir = path.join(base, ent.name);
      const exe = ['', 'x64', 'arm64'].map((s) => dir + (s ? '\\' + s : '') + '\\' + ent.name + '.exe').find(isFile);
      push(dir, exe || null);
      // One level deeper (e.g. %LOCALAPPDATA%\Programs\SomeApp)
      let children = [];
      try { children = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const child of children) {
        if (!child.isDirectory()) continue;
        const childDir = path.join(dir, child.name);
        if (isFile(path.join(childDir, 'resources', 'app.asar'))) {
          let exe2 = null;
          try {
            const exes = fs.readdirSync(childDir).filter((f) => /\.exe$/i.test(f));
            exe2 = exes.length ? path.join(childDir, exes[0]) : null;
          } catch (e) { /* ignore */ }
          push(childDir, exe2);
        }
      }
    }
  }
  return out;
}

/* در مک، هر برنامه یک بسته‌ی .app است و asar در Contents/Resources قرار دارد. */
function findMacApps() {
  const out = [];
  const bases = ['/Applications', path.join(os.homedir(), 'Applications')];
  const seen = new Set();
  for (const base of bases) {
    if (!isDir(base)) continue;
    let entries = [];
    try { entries = fs.readdirSync(base); } catch (e) { continue; }
    for (const name of entries) {
      if (!/\.app$/i.test(name)) continue;
      const appRoot = path.join(base, name);
      const asarPath = path.join(appRoot, 'Contents', 'Resources', 'app.asar');
      if (!isFile(asarPath)) continue;
      const key = path.resolve(asarPath);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(candidateFromAppRoot(appRoot, asarPath, path.join(appRoot, 'Contents', 'MacOS', name.replace(/\.app$/i, ''))));
    }
  }
  return out;
}

/* در لینوکس، AppImageها و بسته‌های deb/rpm معمولاً در /opt یا /usr/lib نصب می‌شوند.
 * حالت snap هم بررسی می‌شود. */
function findLinuxApps() {
  const out = [];
  const seen = new Set();
  const roots = ['/opt', '/usr/lib', '/usr/share', path.join(os.homedir(), '.local/share')];
  const push = (appRoot) => {
    const asarPath = path.join(appRoot, 'resources', 'app.asar');
    if (!isFile(asarPath)) return;
    const key = path.resolve(asarPath);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidateFromAppRoot(appRoot, asarPath, null));
  };
  const scanBase = (base) => {
    if (!isDir(base)) return;
    if (isFile(path.join(base, 'resources', 'app.asar'))) push(base);
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dir = path.join(base, ent.name);
      if (isFile(path.join(dir, 'resources', 'app.asar'))) push(dir);
      let children = [];
      try { children = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const child of children) {
        if (child.isDirectory() && isFile(path.join(dir, child.name, 'resources', 'app.asar'))) {
          push(path.join(dir, child.name));
        }
      }
    }
  };
  roots.forEach(scanBase);
  try {
    const snaps = fs.readdirSync('/snap');
    for (const s of snaps) {
      const p = path.join('/snap', s, 'current');
      if (isDir(p)) scanBase(p);
    }
  } catch (e) { /* no snap */ }
  return out;
}

/* پوشه‌های اضافی که کاربر (یا تست) از طریق متغیر محیطی معرفی می‌کند.
 * قالب: مسیرها با نقطه‌ویرگول (ویندوز) یا دونقطه (لینوکس/مک) جدا می‌شوند
 * — همان جداکننده‌ی استاندارد سیستم‌عامل (path.delimiter). */
function extraScanRoots() {
  const raw = process.env.RTL_UNIVERSAL_SCAN_ROOTS || process.env.RTL_UNIVERSAL_SCAN_DIRS || '';
  return raw.split(path.delimiter).map((s) => s.trim()).filter(Boolean);
}

/* یک پوشه را می‌گردد و ساختار <app>/resources/app.asar را پیدا می‌کند.
 * عمق ۲ سطح: خودِ پوشه و زیرپوشه‌هایش. */
function scanForApps(root) {
  const out = [];
  if (!isDir(root)) return out;
  const push = (dir) => {
    const asarPath = path.join(dir, 'resources', 'app.asar');
    if (isFile(asarPath)) {
      let launcher = null;
      try {
        const exes = fs.readdirSync(dir).filter((f) => /\.exe$/i.test(f));
        if (exes.length) launcher = path.join(dir, exes[0]);
      } catch (e) { /* ignore */ }
      out.push(candidateFromAppRoot(dir, asarPath, launcher));
    }
  };
  push(root);
  let level1 = [];
  try { level1 = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return out; }
  for (const a of level1) {
    if (!a.isDirectory()) continue;
    const dir1 = path.join(root, a.name);
    push(dir1);
    let level2 = [];
    try { level2 = fs.readdirSync(dir1, { withFileTypes: true }); } catch (e) { continue; }
    for (const b of level2) {
      if (b.isDirectory()) push(path.join(dir1, b.name));
    }
  }
  return out;
}

function detectApps() {
  const platform = process.platform;
  // Tests and portable tools can restrict discovery to RTL_UNIVERSAL_SCAN_DIRS.
  // Without this, a patch-all test on a real machine would modify the user's
  // installed apps that happen to be Electron applications.
  const onlyCustom = process.env.RTL_UNIVERSAL_DISABLE_DEFAULT_SCAN === '1';
  let list = onlyCustom ? [] : platform === 'win32' ? findWindowsApps() : platform === 'darwin' ? findMacApps() : findLinuxApps();

  // مسیرهای اضافی (نصب‌های غیرمعمول، حالت portable، یا تست خودکار)
  for (const extra of extraScanRoots()) {
    for (const found of scanForApps(extra)) {
      if (!list.some((c) => path.resolve(c.asar) === path.resolve(found.asar))) list.push(found);
    }
  }

  list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return list;
}

/* ورودی کاربر می‌تواند سه چیز باشد: فایل exe، پوشه‌ی نصب، یا خود app.asar.
 * این تابع همه را به یک مسیر قطعی app.asar تبدیل می‌کند. */
function resolveTarget(inputPath) {
  let p = path.resolve(inputPath);
  if (isFile(p) && path.basename(p).toLowerCase() === 'app.asar') return { asar: p, appRoot: path.dirname(path.dirname(p)) };
  if (isDirectorySafe(p)) {
    // Directory input: app root, resources dir, or .app bundle on macOS
    const tries = [
      path.join(p, 'resources', 'app.asar'),
      path.join(p, 'app.asar'),
      path.join(p, 'Contents', 'Resources', 'app.asar'),
      path.join(p, 'resources', 'app', 'app.asar')
    ];
    for (const t of tries) if (isFile(t)) return { asar: t, appRoot: p };
    return null;
  }
  // Executable input: look for resources/app.asar near it
  if (isFile(p)) {
    const dir = path.dirname(p);
    const tries = [
      path.join(dir, 'resources', 'app.asar'),
      path.join(dir, '..', 'Resources', 'app.asar'),
      path.join(dir, '..', '..', 'Resources', 'app.asar')
    ];
    for (const t of tries) if (isFile(t)) return { asar: path.resolve(t), appRoot: path.resolve(path.join(dir, '..')) };
  }
  return null;
}

function isDirectorySafe(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }

/* ------------------------------------------------------------------ *
 * Script discovery
 * ------------------------------------------------------------------ */
/* ============================================================================
 * پیدا کردن فایل main process
 * ----------------------------------------------------------------------------
 * بین صدها فایل JS داخل asar، کدام «main process» است؟
 * به دنبال نشانه‌ها می‌گردیم:
 *   MAIN_HINT_RE   → فایل electron را require می‌کند
 *   STRONG_HINT_RE → BrowserWindow/app.whenReady دارد (نشانه‌ی قوی)
 * preloadها را حذف می‌کنیم (چون در دنیای دیگری اجرا می‌شوند).
 * ========================================================================== */
function walkScripts(root) {
  const results = [];
  const visit = (dir, depth) => {
    if (depth > 8) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        visit(full, depth + 1);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!SCRIPT_EXTS.has(ext)) continue;
        let size = 0;
        try { size = fs.statSync(full).size; } catch (e) { continue; }
        if (size > 4 * 1024 * 1024) continue;
        results.push({ full, rel: path.relative(root, full).split(path.sep).join('/'), depth, size });
      }
    }
  };
  visit(root, 0);
  return results;
}

const MAIN_HINT_RE = /require\(\s*['"]electron['"]\s*\)|from\s+['"]electron['"]/;
const STRONG_HINT_RE = /BrowserWindow|\bapp\.(whenReady|on|quit|requestSingleInstanceLock|dock)\b|whenReady\(\s*\)/;

function findTargetScripts(workDir, manifestMain, allowUnverified) {
  const files = walkScripts(workDir).filter((f) =>
    f.rel !== HOOK_FILE && f.rel !== LEGACY_HOOK_FILE && f.rel !== ENGINE_FILE &&
    !/preload/i.test(path.basename(f.full))
  );
  const strong = [];
  const weak = [];
  for (const f of files) {
    let content = '';
    try { content = fs.readFileSync(f.full, 'utf8'); } catch (e) { continue; }
    if (content.includes(MARKER)) continue;
    if (!MAIN_HINT_RE.test(content)) continue;
    (STRONG_HINT_RE.test(content) ? strong : weak).push(f);
  }
  strong.sort((a, b) => a.depth - b.depth || a.size - b.size);
  weak.sort((a, b) => a.depth - b.depth || a.size - b.size);

  const chosen = [];
  const hasElectronEvidence = strong.length > 0 || weak.length > 0;
  if (strong.length) chosen.push(strong[0]);
  if (manifestMain && (hasElectronEvidence || allowUnverified)) {
    const mainFile = files.find((f) => f.rel === String(manifestMain).replace(/\\/g, '/'));
    if (mainFile && !chosen.some((c) => c.rel === mainFile.rel)) chosen.push(mainFile);
  }
  if (!chosen.length && weak.length) chosen.push(weak[0]);
  // Blind fallback: only when the caller explicitly allows it (--force).
  // Patching a non-Electron app would be harmless but pointless, so we refuse by default.
  if (!chosen.length && allowUnverified && files.length && manifestMain) {
    const mainFile = files.find((f) => f.rel === String(manifestMain).replace(/\\/g, '/'));
    if (mainFile) chosen.push(mainFile);
  }
  return chosen;
}

/* هُک را در «ابتدای» فایل main می‌گذارد، اما بعد از shebang و 'use strict'
 * تا رفتار فایل اصلی خراب نشود. */
function insertHook(content) {
  const snippet = injectSnippet();
  // Keep a leading shebang / "use strict" directive first.
  const match = /^(\uFEFF?(#![^\n]*\n)?(?:[ \t]*(['"])use strict\3;?[ \t]*\r?\n)?)/.exec(content);
  const head = match ? match[1] : '';
  return head + snippet + content.slice(head.length);
}

/* حذف هُک (برای unpatch): هر خطی که مارکر ما را دارد حذف می‌شود. */
function stripHook(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => line.indexOf(MARKER) === -1)
    .join('\n');
}

/* ------------------------------------------------------------------ *
 * Patch / unpatch
 * ------------------------------------------------------------------ */
function isPatched(asarPath) {
  try {
    const { header } = asar.readHeader(asarPath);
    return !!(header.files && header.files[ENGINE_FILE]);
  } catch (e) {
    return false;
  }
}

/* Read one small packed ASAR entry without loading the whole app.asar. */
function readAsarEntry(asarPath, relPath) {
  const { header, headerSize } = asar.readHeader(asarPath);
  const entry = header.files && header.files[relPath];
  if (!entry || entry.files || entry.link) return null;
  if (entry.unpacked) {
    try { return fs.readFileSync(path.join(asarPath + '.unpacked', relPath)); }
    catch (e) { return null; }
  }
  const size = Number(entry.size);
  const offset = Number(entry.offset);
  if (!Number.isSafeInteger(size) || size < 0 || size > 4 * 1024 * 1024 ||
      !Number.isSafeInteger(offset) || offset < 0) return null;
  const fd = fs.openSync(asarPath, 'r');
  try {
    const result = Buffer.alloc(size);
    const start = 8 + headerSize + offset;
    let read = 0;
    while (read < size) {
      const count = fs.readSync(fd, result, read, size - read, start + read);
      if (!count) return null;
      read += count;
    }
    return result;
  } finally {
    fs.closeSync(fd);
  }
}

/* A green "patched" badge only means runtime files exist. Compare both the
 * engine and hook bytes so a newly shipped build can flag either one as stale. */
function isPatchCurrent(asarPath) {
  try {
    const embeddedEngine = readAsarEntry(asarPath, ENGINE_FILE);
    const embeddedHook = readAsarEntry(asarPath, HOOK_FILE);
    if (!embeddedEngine || !embeddedHook) return false;
    return embeddedEngine.equals(fs.readFileSync(ENGINE_PATH)) &&
      embeddedHook.equals(Buffer.from(HOOK_SOURCE, 'utf8'));
  } catch (e) {
    return false;
  }
}

/* ============================================================================
 * patchApp — عملیات اصلی پچ
 * ----------------------------------------------------------------------------
 * مراحل دقیق:
 *   ۱. پیدا کردن app.asar
 *   ۲. اگر بکاپ قبلی موجود است، از بکاپ شروع کن (پچ روی پچ انباشته نشود)
 *   ۳. باز کردن asar در یک پوشه‌ی موقت
 *   ۴. پیدا کردن فایل main process و بررسی اینکه واقعاً Electron است
 *   ۵. نوشتن فایل‌های موتور/هُک/کانفیگ داخل پوشه
 *   ۶. درج یک خط require در فایل main
 *   ۷. ساخت بکاپ (فقط بار اول) و بسته‌بندی دوباره روی همان مسیر
 *
 * options: mode (smart|rtl|ltr)، css/cssFile، dryRun، force، config
 * ========================================================================== */
function patchApp(inputPath, options) {
  options = options || {};
  const target = resolveTarget(inputPath);
  if (!target) {
    return {
      ok: false,
      error: 'برنامه پیدا نشد. مسیر exe یا پوشه‌ی نصب را بررسی کن.\n(no app.asar found near: ' + inputPath + ')',
      errorEn: 'App not found. Check the exe path or the install folder.\n(no app.asar found near: ' + inputPath + ')'
    };
  }
  const asarPath = target.asar;
  const backupPath = asarPath + BACKUP_SUFFIX;

  if (!isFile(asarPath)) {
    return { ok: false, error: 'app.asar پیدا نشد: ' + asarPath, errorEn: 'app.asar not found: ' + asarPath };
  }
  if (!fs.existsSync(ENGINE_PATH)) {
    return { ok: false, error: 'فایل موتور RTL پیدا نشد: ' + ENGINE_PATH, errorEn: 'RTL engine file not found: ' + ENGINE_PATH };
  }

  const info = manifestInfo(asarPath);
  const plan = {
    app: info.name || path.basename(target.appRoot),
    version: info.version,
    asarPath,
    backupPath,
    scriptFiles: []
  };

  // Always start from the pristine backup when re-patching.
  const sourceAsar = isFile(backupPath) ? backupPath : asarPath;

  let extracted;
  let workDir;
  try {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-universal-'));
    extracted = asar.extractAll(sourceAsar, workDir);
  } catch (e) {
    return { ok: false, error: 'خطا در خواندن app.asar: ' + e.message, errorEn: 'Failed to read app.asar: ' + e.message };
  }

  try {
    const manifest = manifestInfo(sourceAsar);
    const scripts = findTargetScripts(workDir, manifest.main, !!options.force);
    if (!scripts.length) {
      return {
        ok: false,
        error: 'این برنامه شواهد Electron (require("electron") در main-process) ندارد یا ساختارش غیرمعمول است. ' +
          'اگر مطمئنی اپ Electron است، با --force دوباره امتحان کن؛ در غیر این صورت از روش افزونه/یوزراسکریپت استفاده کن.',
        errorEn: 'This app shows no Electron evidence (require("electron") in its main process) or has an unusual layout. ' +
          'If you are sure it is an Electron app, retry with --force; otherwise use the extension/userscript route.'
      };
    }
    plan.scriptFiles = scripts.map((s) => s.rel);

    if (options.dryRun) {
      fs.rmSync(workDir, { recursive: true, force: true });
      return { ok: true, dryRun: true, plan };
    }

    // 1) Runtime files inside the asar
    // A previous patch used rtl-universal.js. Remove it before writing the .cjs
    // hook so an ESM-typed app cannot keep failing on the old extension.
    try { fs.rmSync(path.join(workDir, LEGACY_HOOK_FILE), { force: true }); } catch (e) { /* ignore */ }
    fs.copyFileSync(ENGINE_PATH, path.join(workDir, ENGINE_FILE));
    fs.writeFileSync(path.join(workDir, HOOK_FILE), HOOK_SOURCE, 'utf8');
    const config = {
      mode: options.mode === 'rtl' ? 'rtl' : options.mode === 'ltr' ? 'ltr' : 'smart',
      inputs: true,
      monacoChatInput: true,
      ...(options.config && typeof options.config === 'object' ? options.config : {})
    };
    fs.writeFileSync(path.join(workDir, CONFIG_FILE), JSON.stringify(config, null, 2), 'utf8');
    const css = options.cssFile && isFile(options.cssFile) ? fs.readFileSync(options.cssFile, 'utf8') : (options.css || '');
    if (css) fs.writeFileSync(path.join(workDir, CSS_FILE), css, 'utf8');

    // 2) Hook injections
    for (const s of scripts) {
      const content = fs.readFileSync(s.full, 'utf8');
      fs.writeFileSync(s.full, insertHook(content), 'utf8');
    }
    fs.writeFileSync(path.join(workDir, INJECTED_FILE), JSON.stringify({ scripts: plan.scriptFiles, patchedAt: new Date().toISOString() }, null, 2), 'utf8');

    // 3) Backup pristine archive (once)
    if (!isFile(backupPath)) {
      fs.copyFileSync(asarPath, backupPath);
      plan.backupCreated = true;
    }

    // 4) Repack to a sibling temp path then atomically swap
    const unpackedSet = new Set(extracted.unpacked || []);
    const tmpOut = asarPath + '.rtl-new';
    asar.createPackageFromDirectory(workDir, tmpOut, {
      shouldUnpack: (rel) => unpackedSet.has(rel),
      integrity: true
    });
    const st = fs.statSync(asarPath);
    /* در ویندوز، اگر برنامه باز باشد فایل asar قفل است و rename با
     * EBUSY/EPERM/EACCES شکست می‌خورد. کمی صبر می‌کنیم و دوباره تلاش
     * می‌کنیم (گاهی آنتی‌ویروس فایل را لحظه‌ای نگه داشته است). */
    let renamed = false;
    let lastError = null;
    for (let attempt = 0; attempt < 3 && !renamed; attempt++) {
      try {
        fs.renameSync(tmpOut, asarPath);
        renamed = true;
      } catch (e) {
        lastError = e;
        if (['EBUSY', 'EPERM', 'EACCES'].indexOf(e.code) === -1) throw e;
        const wait = 200 * (attempt + 1);
        const until = Date.now() + wait;
        while (Date.now() < until) { /* انتظار کوتاه همگام */ }
      }
    }
    if (!renamed) {
      try { fs.rmSync(tmpOut, { force: true }); } catch (e2) { /* ignore */ }
      return {
        ok: false,
        error: 'فایل app.asar قفل است یا اجازه‌ی نوشتن نداریم (' + (lastError && lastError.code) + ').\n' +
          'برنامه را کاملاً ببند (از Task Manager هم مطمئن شو) و اگر در Program Files نصب است، پچر را با دسترسی Administrator اجرا کن.',
        errorEn: 'app.asar is locked or not writable (' + (lastError && lastError.code) + ').\n' +
          'Close the app completely (check Task Manager) and, if it is installed under Program Files, run the patcher as Administrator.'
      };
    }
    try { fs.chmodSync(asarPath, st.mode); } catch (e) { /* ignore */ }

    return { ok: true, plan, backupCreated: !!plan.backupCreated };
  } catch (e) {
    try { fs.rmSync(asarPath + '.rtl-new', { force: true }); } catch (e2) { /* ignore */ }
    const friendly = friendlyFsError(e);
    return { ok: false, error: friendly.error, errorEn: friendly.errorEn };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

/* ============================================================================
 * unpatchApp — بازگردانی
 * ----------------------------------------------------------------------------
 * دو حالت دارد:
 *   ۱. اگر بکاپ وجود دارد → آن را روی app.asar کپی می‌کنیم (بایت‌به‌بایت اصلی)
 *   ۲. اگر کاربر بکاپ را پاک کرده → فایل‌های ما را از داخل asar حذف می‌کنیم
 *      و خط هُک را از main process برمی‌داریم (جراحی).
 * ========================================================================== */
function unpatchApp(inputPath) {
  const target = resolveTarget(inputPath);
  if (!target) return { ok: false, error: 'برنامه پیدا نشد: ' + inputPath, errorEn: 'App not found: ' + inputPath };
  const asarPath = target.asar;
  const backupPath = asarPath + BACKUP_SUFFIX;

  try {
    if (isFile(backupPath)) {
      fs.copyFileSync(backupPath, asarPath);
      const st = fs.statSync(backupPath);
      try { fs.chmodSync(asarPath, st.mode); } catch (e) { /* ignore */ }
      fs.unlinkSync(backupPath);
      return { ok: true, mode: 'restore', asarPath };
    }
    // Surgical removal (backup was deleted by user)
    if (!isPatched(asarPath)) return { ok: true, mode: 'clean', asarPath, message: 'این برنامه پچ نشده است.' };
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-universal-un-'));
    try {
      const extracted = asar.extractAll(asarPath, workDir);
      for (const name of [HOOK_FILE, LEGACY_HOOK_FILE, ENGINE_FILE, CONFIG_FILE, CSS_FILE, INJECTED_FILE]) {
        try { fs.rmSync(path.join(workDir, name), { force: true }); } catch (e) { /* ignore */ }
      }
      for (const s of walkScripts(workDir)) {
        const content = fs.readFileSync(s.full, 'utf8');
        if (content.includes(MARKER)) fs.writeFileSync(s.full, stripHook(content), 'utf8');
      }
      const unpackedSet = new Set(extracted.unpacked || []);
      const tmpOut = asarPath + '.rtl-new';
      asar.createPackageFromDirectory(workDir, tmpOut, { shouldUnpack: (rel) => unpackedSet.has(rel) });
      fs.renameSync(tmpOut, asarPath);
      return { ok: true, mode: 'surgical', asarPath };
    } finally {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  } catch (e) {
    const friendly = friendlyFsError(e);
    return { ok: false, error: 'خطا هنگام حذف پچ: ' + friendly.error, errorEn: 'Error while unpatching: ' + friendly.errorEn };
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */
/* ============================================================================
 * CLI — خواندن آرگومان‌های خط فرمان
 * ----------------------------------------------------------------------------
 * مثال: node patch-electron.js --app "C:\Apps\Foo" --mode rtl
 * argv آرایه‌ی کلمه‌های بعد از نام برنامه است؛ این تابع آن را به شیء تبدیل می‌کند.
 * ========================================================================== */
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app') args.app = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--mode') args.mode = argv[++i];
    else if (a === '--css') args.css = argv[++i];
    else if (a === '--css-file') args.cssFile = argv[++i];
    else if (a === '--unpatch') args.unpatch = true;
    else if (a === '--list') args.list = true;
    else if (a === '--status') args.status = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

function printHelp() {
  console.log(`
CyrusAsha_UniversalRTL-1.0.0 — پچر راست‌چین هوشمند برای اپ‌های Electron
════════════════════════════════════════════════════════════

  node patch-electron.js [گزینه‌ها]

گزینه‌ها:
  --list                فهرست اپ‌های Electron نصب‌شده
  --app <path>          مسیر exe یا پوشه نصب برنامه
  --name <text>         انتخاب برنامه با جستجوی نام (مثلاً hermes)
  --status              بررسی وضعیت پچ
  --unpatch             حذف پچ و بازگردانی نسخه اصلی
  --dry-run             فقط نمایش فایل‌هایی که پچ می‌شوند
  --mode smart|rtl|ltr  حالت پیش‌فرض: smart (تشخیص خودکار)
  --css "<css>"         CSS سفارشی (فونت و…)
  --css-file <path>     فایل CSS سفارشی
  --help                همین راهنما

نمونه‌ها:
  node patch-electron.js --list
  node patch-electron.js --name hermes
  node patch-electron.js --app "%LOCALAPPDATA%\\Programs\\freebuff\\Freebuff.exe"
  node patch-electron.js --app "C:\\Apps\\Freebuff" --unpatch

نکته: قبل از پچ، برنامه را کاملاً ببند. یک بکاپ خودکار
app.asar.rtl-backup ساخته می‌شود و --unpatch آن را برمی‌گرداند.
`);
}

function formatCandidate(c, i) {
  const version = c.version ? ' v' + c.version : '';
  const patched = !isPatched(c.asar) ? '' : isPatchCurrent(c.asar) ? '  [پچ‌شده]' : '  [نیازمند به‌روزرسانی]';
  const exe = c.launcher ? '\n      ' + c.launcher : '';
  return '  ' + String(i + 1).padStart(2) + '. ' + c.name + version + patched + '\n      ' + c.asar + exe;
}

/* نقطه‌ی شروع برنامه‌ی خط فرمان.
 * ترتیب بررسی: --help → --status → --unpatch → --list → انتخاب تعاملی → پچ.
 * اگر هیچ گزینه‌ای ندهی، فهرست اپ‌ها را نشان می‌دهد و شماره می‌پرسد. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = console.log;

  if (args.help) { printHelp(); return; }

  // Status
  if (args.status) {
    if (!args.app && args._[0]) args.app = args._[0];
    const target = args.app ? resolveTarget(args.app) : null;
    if (!target) { console.error('مسیر برنامه مشخص نشد. از --app استفاده کن.'); process.exitCode = 2; return; }
    const patched = isPatched(target.asar);
    const current = patched && isPatchCurrent(target.asar);
    out(!patched
      ? '⚪ این برنامه پچ نشده است: ' + target.asar
      : current
        ? '✅ برنامه پچ شده و موتور آن به‌روز است: ' + target.asar
        : '⚠️ پچ وجود دارد، اما موتور قدیمی است؛ دوباره پچ کن: ' + target.asar);
    return;
  }

  // Unpatch
  if (args.unpatch) {
    let input = args.app;
    if (!input && args.name) {
      const found = detectApps().find((c) => c.name.toLowerCase().includes(args.name.toLowerCase()));
      if (found) input = found.appRoot;
    }
    if (!input && args._[0]) input = args._[0];
    if (!input) { console.error('برای حذف پچ، --app یا --name بده.'); process.exitCode = 2; return; }
    const res = unpatchApp(input);
    if (!res.ok) { console.error('❌ ' + res.error); process.exitCode = 1; return; }
    out(res.mode === 'restore'
      ? '✅ پچ حذف شد و نسخه اصلی از بکاپ برگردانده شد:\n   ' + res.asarPath
      : res.mode === 'clean' ? 'ℹ️ ' + res.message
        : '✅ فایل‌های RTL حذف شدند:\n   ' + res.asarPath);
    out('برنامه را دوباره اجرا کن.');
    return;
  }

  // List / interactive detection
  const apps = detectApps();
  if (args.list) {
    if (!apps.length) { out('هیچ اپ Electron دارای resources/app.asar پیدا نشد.'); return; }
    out('\nاپ‌های Electron پیدا‌شده:\n' + apps.map(formatCandidate).join('\n\n') + '\n');
    return;
  }

  let chosenAppPath = args.app;
  if (!chosenAppPath && args.name) {
    const matches = apps.filter((c) =>
      (c.name + ' ' + c.appRoot + ' ' + (c.launcher || '')).toLowerCase().includes(args.name.toLowerCase()));
    if (matches.length === 1) chosenAppPath = matches[0].appRoot;
    else if (matches.length > 1) {
      out('چند برنامه با این نام پیدا شد:\n' + matches.map(formatCandidate).join('\n\n'));
      chosenAppPath = matches[0].appRoot;
      out('\nانتخاب شد: ' + matches[0].name);
    } else { console.error('برنامه‌ای با نام «' + args.name + '» پیدا نشد.'); process.exitCode = 2; return; }
  }
  if (!chosenAppPath && args._[0]) chosenAppPath = args._[0];

  // Interactive menu
  if (!chosenAppPath) {
    if (!apps.length) { out('هیچ اپ Electron دارای resources/app.asar پیدا نشد.'); return; }
    out('\nاپ‌های Electron پیدا‌شده:\n');
    apps.forEach((c, i) => out(formatCandidate(c, i)));
    out('\n  0. خروج');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
    const answer = (await ask('\nشماره برنامه برای پچ (یا 0): ')).trim();
    if (!answer || answer === '0') { rl.close(); return; }
    const idx = parseInt(answer, 10) - 1;
    if (!(idx >= 0 && idx < apps.length)) { rl.close(); console.error('شماره نامعتبر.'); process.exitCode = 2; return; }
    const confirm = (await ask('پچ شود؟ (y/N): ')).trim().toLowerCase();
    rl.close();
    if (confirm !== 'y' && confirm !== 'yes') { out('لغو شد.'); return; }
    chosenAppPath = apps[idx].appRoot;
  }

  const res = patchApp(chosenAppPath, {
    mode: args.mode,
    css: args.css,
    cssFile: args.cssFile,
    dryRun: args.dryRun,
    force: args.force
  });

  if (!res.ok) { console.error('❌ ' + res.error); process.exitCode = 1; return; }
  if (res.dryRun) {
    out('🔍 حالت آزمایشی — برنامه: ' + res.plan.app + (res.plan.version ? ' v' + res.plan.version : ''));
    out('   app.asar: ' + res.plan.asarPath);
    out('   فایل‌های تزریق‌شونده (main process):');
    res.plan.scriptFiles.forEach((f) => out('     - ' + f));
    out('\n   برای اعمال واقعی، --dry-run را حذف کن.');
    return;
  }
  out('✅ پچ با موفقیت اعمال شد');
  out('   برنامه: ' + res.plan.app + (res.plan.version ? ' v' + res.plan.version : ''));
  out('   app.asar: ' + res.plan.asarPath);
  out('   فایل‌های هُک: ' + res.plan.scriptFiles.join(', '));
  out('   بکاپ: ' + res.plan.backupPath + (res.backupCreated ? ' (ساخته شد)' : ' (از قبل موجود بود)'));
  out('\nبرنامه را ببند و دوباره باز کن. برای حذف: --unpatch');
}

module.exports = {
  detectApps,
  resolveTarget,
  patchApp,
  unpatchApp,
  isPatched,
  isPatchCurrent,
  findTargetScripts,
  insertHook,
  stripHook,
  friendlyFsError,
  HOOK_FILE,
  LEGACY_HOOK_FILE,
  ENGINE_FILE,
  CONFIG_FILE,
  CSS_FILE,
  HOOK_SOURCE,
  BACKUP_SUFFIX
};

if (require.main === module) {
  main().catch((e) => { console.error('❌ خطای غیرمنتظره: ' + e.message); process.exitCode = 1; });
}
