#!/usr/bin/env node
/**
 * CyrusAsha_UniversalRTL-1.0.0 — Control Panel (مرکز کنترل گرافیکی)
 *
 * یک برنامه‌ی محلی با رابط فارسی که بدون ترمینال، اپ‌های Electron را پیدا و
 * با یک کلیک پچ/آنپچ می‌کند، افزونه‌ی IDE را نصب می‌کند و تنظیمات را ذخیره می‌کند.
 *
 * اجرا:  npm start   →  http://localhost:4477
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const patcher = require('../patcher/patch-electron');
const asar = require('../patcher/asar');

/* ============================================================================
 * مرکز کنترل CyrusAsha_UniversalRTL-1.0.0 — سرور محلی
 * ----------------------------------------------------------------------------
 * این فایل یک «سرور HTTP کوچک» است که روی کامپیوتر خودت اجرا می‌شود.
 * مرورگر به آن وصل می‌شود، رابط فارسی/انگلیسی را نشان می‌دهد و درخواست‌ها
 * (پچ کن، حذف پچ کن، تنظیمات را ذخیره کن…) را به اینجا می‌فرستد.
 *
 * چرا سرور لازم است؟ چون مرورگر به‌تنهایی اجازه‌ی خواندن/نوشتن فایل‌های
 * سیستم را ندارد. این سرور همان دسترسی را به‌صورت کنترل‌شده فراهم می‌کند.
 *
 * فهرست مسیرهای API (همه زیر /api/):
 *   GET  /api/state      → همه‌ی اطلاعات لازم برای نمایش صفحه
 *   GET  /api/log        → پیام‌های تازه‌ی گزارش
 *   POST /api/scan       → جستجوی مجدد اپ‌ها
 *   POST /api/patch      → پچ یک برنامه { appRoot }
 *   POST /api/patch-all  → پچ همه‌ی برنامه‌های پچ‌نشده
 *   POST /api/unpatch    → حذف پچ ({ appRoot } یا { all: true })
 *   POST /api/add-path   → افزودن مسیر دستی
 *   POST /api/settings   → ذخیره‌ی تنظیمات
 *   POST /api/install-extension → نصب افزونه در IDE
 *   POST /api/build-vsix → ساخت بسته‌ی افزونه
 * ========================================================================== */
const { projectRoot, isStandalone } = require('../shared/paths');

/* ریشه‌ی پروژه: در حالت عادی پوشه‌ی مخزن، در حالت فایل اجرایی ویندوزی
 * پوشه‌ای که exe در آن قرار دارد. */
const ROOT = projectRoot();
/* پوشه‌ی فایل‌های رابط کاربری.
 * در اجرای معمولی کنار همین فایل است؛ در فایل اجرایی تک‌فایلی (exe)
 * باید کنار exe و داخل src/gui/public باشد. */
const PUBLIC_DIR = (() => {
  const candidates = [
    path.join(__dirname, 'public'),
    path.join(ROOT, 'src', 'gui', 'public')
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, 'index.html'))) return c; } catch (e) { /* ignore */ }
  }
  return candidates[0];
})();
const ENGINE_PATH = path.join(ROOT, 'src', 'engine', 'rtl-engine.js');
const CONFIG_DIR = process.env.RTL_UNIVERSAL_HOME || path.join(os.homedir(), '.rtl-universal');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}
/* پورت و آدرس اتصال.
 * پیش‌فرض 127.0.0.1 است: فقط همین کامپیوتر به مرکز کنترل دسترسی دارد و
 * ویندوز هنگام اجرا «هشدار فایروال» نشان نمی‌دهد (امن‌تر برای کاربر).
 * اگر در محیطی مثل پیش‌نمایش آنلاین اجرا می‌کنید، --host 0.0.0.0 بدهید. */
const PORT = Number(argValue('--port') || process.env.PORT || 4477);
const HOST = argValue('--host') || process.env.RTL_GUI_HOST || '127.0.0.1';
const AUTO_OPEN = !args.includes('--no-open');

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */
const DEFAULT_CONFIG = {
  mode: 'smart',
  inputs: true,
  monacoChatInput: true,
  extraCSS: '',
  cssFile: '',
  customApps: [],
  lastScan: null
};

/* تنظیمات در ~/.rtl-universal/config.json ذخیره می‌شود تا بعد از بستن
 * برنامه هم باقی بماند. اگر فایل نباشد یا خراب باشد، مقادیر پیش‌فرض برمی‌گردند. */
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return Object.assign({}, DEFAULT_CONFIG, raw);
  } catch (e) {
    return Object.assign({}, DEFAULT_CONFIG);
  }
}
function saveConfig(cfg) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (e) {
    log('save_failed', 'error', { error: e.message });
    return false;
  }
}

let config = loadConfig();

/* ------------------------------------------------------------------ *
 * Log ring buffer
 * ------------------------------------------------------------------ */
/* ============================================================================
 * گزارش زنده (Live log)
 * ----------------------------------------------------------------------------
 * سرور پیام‌ها را به شکل «کد + پارامتر» ذخیره می‌کند، نه متن آماده.
 * چرا؟ چون رابط کاربری دو زبانه است: کلاینت خودش کد را به فارسی یا انگلیسی
 * ترجمه می‌کند. مثال:
 *     log('patched', 'ok', { name: 'Hermes' })
 * کلاینت فارسی نشان می‌دهد: «Hermes» با موفقیت پچ شد
 * کلاینت انگلیسی نشان می‌دهد: Patched "Hermes" successfully
 *
 * اگر کدی در دیکشنری کلاینت نبود، خود کد نمایش داده می‌شود (fallback).
 * ========================================================================== */
const LOG_LIMIT = 300;
let logs = [];
let logSeq = 0;
function log(code, level, params) {
  logSeq++;
  logs.push({
    id: logSeq,
    at: new Date().toISOString(),
    level: level || 'info',
    code: String(code),
    params: params || {}
  });
  if (logs.length > LOG_LIMIT) logs = logs.slice(-LOG_LIMIT);
  if (process.env.RTL_UNIVERSAL_DEBUG) {
    console.log('[' + (level || 'info') + '] ' + code + ' ' + JSON.stringify(params || {}));
  }
}

/* ------------------------------------------------------------------ *
 * App discovery
 * ------------------------------------------------------------------ */
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }

/* یک پوشه را (تا دو سطح) می‌گردد و هر زیرپوشه‌ای که resources/app.asar دارد
 * را به‌عنوان یک برنامه ثبت می‌کند.
 * نکته: خودِ پوشه‌ی پایه «برنامه» نیست؛ مجموعه‌ای از برنامه‌هاست. */
function scanRoot(root, found, depth) {
  if (!root || !isDir(root) || depth < 0) return;
  const base = path.resolve(root);
  const push = (dir) => {
    const asarPath = path.join(dir, 'resources', 'app.asar');
    // A scan root is a *container* of apps, not an app itself.
    if (path.resolve(dir) === base) return;
    if (isFile(asarPath)) found.push({ appRoot: dir, asar: asarPath });
  };
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const dir = path.join(root, ent.name);
    push(dir);
    if (depth > 0) {
      let children = [];
      try { children = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const child of children) {
        if (child.isDirectory()) push(path.join(dir, child.name));
      }
    }
  }
}

function customScanDirs() {
  const env = process.env.RTL_UNIVERSAL_SCAN_DIRS;
  if (!env) return [];
  return env.split(path.delimiter).map((s) => s.trim()).filter(Boolean);
}

/* فهرست نهایی همه‌ی برنامه‌ها.
 * منابع:
 *   ۱. مسیرهای استاندارد سیستم‌عامل (patcher.detectApps)
 *   ۲. متغیر محیطی RTL_UNIVERSAL_SCAN_DIRS (برای تست/پرتابل)
 *   ۳. مسیرهای دستی‌ای که کاربر اضافه کرده
 * برای هر برنامه نام/نسخه را از package.json داخل asar می‌خوانیم و
 * وضعیت پچ را مشخص می‌کنیم. */
function listApps() {
  const apps = new Map();
  const addRaw = (appRoot, asarPath, launcher) => {
    const key = path.resolve(asarPath).toLowerCase();
    if (apps.has(key)) return;
    let info = null;
    try { info = asar.readManifest(asarPath); } catch (e) { info = null; }
    let patched = false;
    let hasIntegrity = false;
    try {
      patched = patcher.isPatched(asarPath);
      const h = asar.readHeader(asarPath);
      hasIntegrity = !!(h.header && h.header.integrity);
    } catch (e) { /* ignore */ }
    apps.set(key, {
      id: Buffer.from(key).toString('base64url').slice(0, 16),
      appRoot,
      asar: asarPath,
      launcher: launcher || null,
      name: (info && (info.productName || info.name)) || path.basename(appRoot),
      version: (info && info.version) || null,
      patched,
      hasIntegrity,
      backup: isFile(asarPath + patcher.BACKUP_SUFFIX),
      custom: false
    });
  };

  // Built-in detection
  try {
    for (const c of patcher.detectApps()) addRaw(c.appRoot, c.asar, c.launcher);
  } catch (e) { log('scan_default_error', 'error', { error: e.message }); }

  // Extra scan roots (env + custom dirs)
  const roots = customScanDirs();
  for (const c of config.customApps) {
    const t = patcher.resolveTarget(c);
    if (t) addRaw(t.appRoot, t.asar, null);
    else if (isDir(c)) roots.push(c);
  }
  for (const root of roots) {
    const found = [];
    scanRoot(root, found, 2);
    for (const f of found) addRaw(f.appRoot, f.asar, null);
  }

  const list = Array.from(apps.values());
  list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return list;
}

function findApp(appRoot) {
  if (!appRoot) return null;
  const apps = listApps();
  const needle = path.resolve(String(appRoot)).toLowerCase();
  return apps.find((a) => path.resolve(a.appRoot).toLowerCase() === needle ||
    path.resolve(a.asar).toLowerCase() === needle) || null;
}

/* ------------------------------------------------------------------ *
 * IDE / extension helpers
 * ------------------------------------------------------------------ */
const IDE_CLIS = [
  { cmd: 'code', label: 'VS Code' },
  { cmd: 'code-insiders', label: 'VS Code Insiders' },
  { cmd: 'codium', label: 'VSCodium' },
  { cmd: 'antigravity', label: 'Antigravity' },
  { cmd: 'cursor', label: 'Cursor' },
  { cmd: 'windsurf', label: 'Windsurf' },
  { cmd: 'kiro', label: 'Kiro' },
  { cmd: 'trae', label: 'Trae' }
];

function which(cmd) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  try {
    const res = spawnSync(checker, [cmd], { encoding: 'utf8', timeout: 4000 });
    if (res.status === 0) {
      const first = String(res.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      return first || null;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function detectIdes() {
  return IDE_CLIS.map((ide) => ({ ...ide, path: which(ide.cmd), found: !!which(ide.cmd) }));
}

/* اگر فایل VSIX وجود نداشت، همین‌جا می‌سازیمش (با build-vsix.js).
 * این باعث می‌شود کاربر لازم نباشد دستور جداگانه‌ای اجرا کند. */
function ensureVsix() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vscode-extension', 'package.json'), 'utf8'));
  const out = path.join(ROOT, 'release', pkg.publisher + '.' + pkg.name + '-' + pkg.version + '.vsix');
  if (isFile(out)) return out;
  const builder = require(path.join(ROOT, 'vscode-extension', 'build-vsix.js'));
  builder.main();
  return out;
}

  /* اگر فایل یوزراسکریپت وجود نداشت، با همان اسکریپت build-assets.js می‌سازیمش.
   * (همان موتور + تنظیمات پیش‌فرض، با سرصفحه‌ی ==UserScript==) */
  function ensureUserscript() {
    const out = path.join(ROOT, 'release', 'rtl-universal.user.js');
    if (isFile(out)) return out;
    require(path.join(ROOT, 'scripts', 'build-assets.js')).main();
    return out;
  }

  /*
   * ساخت بسته‌ی مرورگر در صورت نبودن فایل خروجی.
   * مسیرها ثابت‌اند؛ هیچ‌وقت مسیر فایل را از درخواست کاربر نمی‌گیریم.
   */
  function ensureBrowserPackage(kind) {
    const projectVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const productName = 'CyrusAsha_UniversalRTL';
    const browserName = kind === 'firefox' ? 'Firefox' : 'Chrome';
    const extension = kind === 'firefox' ? '.xpi' : kind === 'chrome-crx' ? '.crx' : '.zip';
    const defaultOut = path.join(ROOT, 'release', 'browser', productName + '-' + projectVersion + '-' + browserName + extension);
    const configuredCrxOutput = kind === 'chrome-crx' && process.env.RTL_CHROME_EXTENSION_OUTPUT;
    const out = configuredCrxOutput
      ? (path.isAbsolute(configuredCrxOutput) ? configuredCrxOutput : path.join(ROOT, configuredCrxOutput))
      : defaultOut;
    if (isFile(out)) return out;

    if (kind === 'chrome-crx') {
      const sourceDir = path.join(ROOT, 'release', 'browser', 'chrome-unpacked');
      if (!isFile(path.join(sourceDir, 'manifest.json'))) {
        require(path.join(ROOT, 'scripts', 'build-browser-extension.js')).main();
      }
      const build = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-chrome-crx.js')], { encoding: 'utf8' });
      if (build.status !== 0) throw new Error((build.stderr || build.stdout || 'CRX build failed').trim());
      if (!isFile(out)) throw new Error('CRX output was not created: ' + out);
      return out;
    }

    require(path.join(ROOT, 'scripts', 'build-browser-extension.js')).main();
    if (!isFile(out)) throw new Error('Browser package was not created: ' + out);
    return out;
  }

  /* نصب افزونه با CLI خود IDE: مسیر VSIX از package.json نسخه‌دار ساخته می‌شود.
 * خروجی فرمان را برمی‌گردانیم تا کاربر در صورت خطا بداند چه شده. */
function installExtension(cli) {
  const ide = IDE_CLIS.find((i) => i.cmd === cli) || IDE_CLIS[0];
  const exe = which(ide.cmd);
  if (!exe) return { ok: false, error: 'CLI «' + ide.label + '» روی PATH پیدا نشد.' };
  let vsix;
  try { vsix = ensureVsix(); } catch (e) { return { ok: false, error: 'ساخت VSIX ناموفق: ' + e.message }; }
  const res = spawnSync(exe, ['--install-extension', vsix, '--force'], {
    encoding: 'utf8',
    timeout: 120000,
    shell: process.platform === 'win32'
  });
  const output = ((res.stdout || '') + (res.stderr || '')).trim();
  if (res.status === 0) {
    log('installed', 'ok', { label: ide.label });
    return { ok: true, ide: ide.label, output };
  }
  log('install_failed', 'error', { label: ide.label, error: output });
  return { ok: false, ide: ide.label, error: output || 'exit ' + res.status };
}

/* ------------------------------------------------------------------ *
 * HTTP helpers
 * ------------------------------------------------------------------ */
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(data);
  });
}

/* سرو کردن یوزراسکریپت برای نصب در Tampermonkey/Violentmonkey.
 * نام فایل در URL عمداً `.user.js` است؛ افزونه‌های مدیریت اسکریپت از همین
 * پسوند و سرصفحه‌ی `// ==UserScript==` می‌فهمند که این یک اسکریپت قابل نصب است. */
function serveUserscript(res) {
  let file;
  try {
    file = ensureUserscript();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('userscript build failed: ' + e.message);
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'content-disposition': 'inline; filename="rtl-universal.user.js"',
      'cache-control': 'no-store'
    });
    res.end(data);
  });
}

/* Serve a native browser-extension archive as a real download.
 * Chrome cannot silently install a local ZIP, and an unsigned Firefox XPI is
 * temporary; the attachment response makes the package available without
 * pretending that a local dashboard can bypass browser-store security. */
function serveBrowserPackage(res, kind) {
  let file;
  try {
    file = ensureBrowserPackage(kind);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('browser extension build failed: ' + e.message);
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, {
      'content-type': path.extname(file) === '.crx' ? 'application/x-chrome-extension' : 'application/octet-stream',
      'content-disposition': 'attachment; filename="' + path.basename(file) + '"',
      'cache-control': 'no-store'
    });
    res.end(data);
  });
}

/* فایل متنی ساده (بوکمارکلت) — همیشه به‌صورت inline تا در مرورگر باز شود. */
function serveText(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(data);
  });
}

function engineScript(res) {
  let engine = '';
  try { engine = fs.readFileSync(ENGINE_PATH, 'utf8'); } catch (e) { /* ignore */ }
  const cfg = { mode: config.mode, inputs: config.inputs, monacoChatInput: config.monacoChatInput, extraCSS: config.extraCSS };
  res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
  res.end('window.__RTL_UNIVERSAL_CONFIG__ = ' + JSON.stringify(cfg) + ';\n' + engine);
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */
/* «وضعیت کامل» برای رابط کاربری: برنامه‌ها، IDEهای نصب‌شده، تنظیمات،
 * وضعیت فایل VSIX و آمار. کلاینت فقط همین یک پاسخ را می‌گیرد. */
function statePayload() {
  let apps = [];
  try { apps = listApps(); } catch (e) { log('list_error', 'error', { error: e.message }); }
  let vsix = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vscode-extension', 'package.json'), 'utf8'));
    const p = path.join(ROOT, 'release', pkg.publisher + '.' + pkg.name + '-' + pkg.version + '.vsix');
    vsix = { path: p, exists: isFile(p), size: isFile(p) ? fs.statSync(p).size : 0, name: path.basename(p) };
  } catch (e) { /* ignore */ }
  return {
    engineVersion: readEngineVersion(),
    config: {
      mode: config.mode,
      inputs: config.inputs,
      monacoChatInput: config.monacoChatInput,
      extraCSS: config.extraCSS,
      cssFile: config.cssFile
    },
    apps,
    ides: detectIdes(),
    vsix,
    platform: process.platform,
    home: CONFIG_DIR,
    scanDirs: customScanDirs(),
    stats: {
      total: apps.length,
      patched: apps.filter((a) => a.patched).length
    }
  };
}

function readEngineVersion() {
  try {
    const src = fs.readFileSync(ENGINE_PATH, 'utf8');
    const m = /var VERSION = '([^']+)'/.exec(src);
    return m ? m[1] : 'unknown';
  } catch (e) { return 'unknown'; }
}

/* یک «روتر» ساده: بر اساس متد (GET/POST) و مسیر، کار درست را انجام می‌دهد.
 * همه‌ی خطاها گرفته می‌شوند و به‌صورت JSON برمی‌گردند تا رابط کاربری
 * هیچ‌وقت با صفحه‌ی سفید یا خطای خام مواجه نشود. */
async function handleApi(req, res, pathname) {
  try {
    if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, statePayload());

    if (req.method === 'GET' && pathname === '/api/log') {
      const since = Number(new URL(req.url, 'http://x').searchParams.get('since') || 0);
      return json(res, 200, { logs: logs.filter((l) => l.id > since), lastId: logSeq });
    }

    if (req.method === 'POST' && pathname === '/api/scan') {
      log('scan_started');
      const apps = listApps();
      log('scan_done', 'info', { count: apps.length });
      return json(res, 200, { ok: true, apps });
    }

    if (req.method === 'POST' && (pathname === '/api/patch' || pathname === '/api/patch-all')) {
      const body = await readBody(req);
      const mode = body.mode || config.mode;
      const css = body.css !== undefined ? body.css : config.extraCSS;
      const cssFile = config.cssFile || undefined;
      const targets = pathname === '/api/patch-all' ? listApps().filter((a) => !a.patched) : [findApp(body.appRoot)];
      if (!targets.length || targets.some((t) => !t)) {
        return json(res, 400, { ok: false, error: 'برنامه پیدا نشد.' });
      }
      const results = [];
      for (const app of targets) {
        log('patching', 'info', { name: app.name });
        const r = patcher.patchApp(app.appRoot, { mode, css, cssFile });
        if (r.ok) {
          log('patched', 'ok', { name: app.name, scripts: r.plan.scriptFiles.join(', ') });
          results.push({ name: app.name, ok: true, scripts: r.plan.scriptFiles });
        } else {
          log('patch_failed', 'error', { name: app.name, error: r.errorEn || r.error });
          results.push({ name: app.name, ok: false, error: r.error, errorEn: r.errorEn || r.error });
        }
      }
      return json(res, 200, { ok: results.every((r) => r.ok), results });
    }

    if (req.method === 'POST' && pathname === '/api/unpatch') {
      const body = await readBody(req);
      const target = body.all ? null : findApp(body.appRoot);
      if (body.all) {
        const results = [];
        for (const app of listApps().filter((a) => a.patched || a.backup)) {
          log('unpatching', 'info', { name: app.name });
          const r = patcher.unpatchApp(app.appRoot);
          if (r.ok) log('unpatched', 'ok', { name: app.name });
          else log('patch_failed', 'error', { name: app.name, error: r.errorEn || r.error });
          results.push({ name: app.name, ok: r.ok, error: r.error, errorEn: r.errorEn || r.error });
        }
        return json(res, 200, { ok: results.every((r) => r.ok), results });
      }
      if (!target) return json(res, 400, { ok: false, error: 'برنامه پیدا نشد.' });
      log('unpatching', 'info', { name: target.name });
      const r = patcher.unpatchApp(target.appRoot);
      if (r.ok) log('unpatched', 'ok', { name: target.name, mode: r.mode });
      else log('unpatch_failed', 'error', { name: target.name, error: r.errorEn || r.error });
      return json(res, 200, r);
    }

    if (req.method === 'POST' && pathname === '/api/add-path') {
      const body = await readBody(req);
      const p = String(body.path || '').trim();
      if (!p) return json(res, 400, { ok: false, error: 'مسیر خالی است.' });
      const expanded = p.replace(/%([^%]+)%/g, (_, v) => process.env[v] || process.env[v.toUpperCase()] || '').replace(/^~/, os.homedir());
      if (!isFile(expanded) && !isDir(expanded)) {
        return json(res, 400, { ok: false, error: 'مسیر پیدا نشد: ' + expanded });
      }
      const t = patcher.resolveTarget(expanded);
      if (!t) return json(res, 400, { ok: false, error: 'در این مسیر app.asar پیدا نشد.' });
      if (!config.customApps.includes(t.appRoot)) {
        config.customApps.push(t.appRoot);
        saveConfig(config);
      }
      log('path_added', 'ok', { path: t.appRoot });
      return json(res, 200, { ok: true, appRoot: t.appRoot });
    }

    if (req.method === 'POST' && pathname === '/api/remove-path') {
      const body = await readBody(req);
      config.customApps = config.customApps.filter((p) => p !== body.appRoot);
      saveConfig(config);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/settings') {
      const body = await readBody(req);
      if (['smart', 'rtl', 'ltr'].includes(body.mode)) config.mode = body.mode;
      if (typeof body.inputs === 'boolean') config.inputs = body.inputs;
      if (typeof body.monacoChatInput === 'boolean') config.monacoChatInput = body.monacoChatInput;
      if (typeof body.extraCSS === 'string') config.extraCSS = body.extraCSS;
      saveConfig(config);
      log('settings_saved', 'info', { mode: config.mode });
      const res2 = statePayload();
      return json(res, 200, { ok: true, config: res2.config });
    }

    if (req.method === 'POST' && pathname === '/api/install-extension') {
      const body = await readBody(req);
      log('installing', 'info', { cli: body.cli || 'code' });
      const r = installExtension(body.cli || 'code');
      return json(res, 200, r);
    }

    if (req.method === 'POST' && pathname === '/api/build-vsix') {
      try {
        const p = ensureVsix();
        log('vsix_ready', 'ok', { name: path.basename(p) });
        return json(res, 200, { ok: true, path: p });
      } catch (e) {
        log('vsix_failed', 'error', { error: e.message });
        return json(res, 500, { ok: false, error: e.message });
      }
    }

    if (req.method === 'POST' && pathname === '/api/open-folder') {
      const body = await readBody(req);
      const target = body.path;
      if (!target || !isDir(target)) return json(res, 400, { ok: false, error: 'پوشه پیدا نشد.' });
      const cmd = process.platform === 'win32' ? 'explorer'
        : process.platform === 'darwin' ? 'open' : 'xdg-open';
      try {
        spawnSync(cmd, [target], { timeout: 5000 });
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message });
      }
    }

    return json(res, 404, { ok: false, error: 'مسیر API نامعتبر: ' + pathname });
  } catch (e) {
    log('server_error', 'error', { error: e.message });
    return json(res, 500, { ok: false, error: e.message });
  }
}

/* ------------------------------------------------------------------ *
 * Server
 * ------------------------------------------------------------------ */
/* مسیرهای غیر-API فایل‌های استاتیک هستند:
 *   /            → رابط کاربری (public/index.html)
 *   /engine.js   → موتور واقعی RTL (تا صفحه‌ی «تست تشخیص جهت» از همان کد استفاده کند)
 * همه‌ی پاسخ‌ها CORS آزاد دارند تا از پیش‌نمایش‌های آنلاین هم باز شوند. */
const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);

  // Permissive CORS for the preview proxy / local tooling.
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    if (pathname === '/engine.js') return engineScript(res);
    /* مسیر نصب برای چت‌های وب: چون آدرس با .user.js تمام می‌شود، Tampermonkey
     * خودش پیشنهاد نصب می‌دهد. Content-Disposition: inline لازم است تا
     * مرورگر فایل را دانلود نکند و افزونه بتواند آن را بخواند. */
    if (pathname === '/install/rtl-universal.user.js') return serveUserscript(res);
    if (pathname === '/install/browser/chrome.crx') return serveBrowserPackage(res, 'chrome-crx');
    if (pathname === '/install/browser/chrome.zip') return serveBrowserPackage(res, 'chrome');
    if (pathname === '/install/browser/firefox.xpi') return serveBrowserPackage(res, 'firefox');
    if (pathname === '/install/bookmarklet.txt') return serveText(res, path.join(ROOT, 'release', 'bookmarklet.txt'));
  if (pathname === '/' || pathname === '/index.html') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  return serveFile(res, path.join(PUBLIC_DIR, pathname.replace(/^\/+/, '')));
});

/* باز کردن مرورگر پیش‌فرض روی آدرس مرکز کنترل.
 * روی ویندوز از `cmd /c start`، روی مک `open` و روی لینوکس `xdg-open`.
 * اگر اجرای خودکار ممکن نبود، فقط آدرس چاپ می‌شود. */
function openBrowser(url) {
  if (!AUTO_OPEN) return;
  try {
    const { spawn } = require('child_process');
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) { /* باز کردن مرورگر اختیاری است */ }
}

/* اگر پورت اشغال بود، ۱۰ پورت بعدی را امتحان می‌کنیم.
 * (مثلاً وقتی یک نسخه از مرکز کنترل از قبل باز است.) */
let listenAttempt = 0;
function startListening(port) {
  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && listenAttempt < 10) {
      listenAttempt++;
      log('port_busy', 'info', { port: port, next: port + 1 });
      startListening(port + 1);
      return;
    }
    console.error('Could not start the control panel: ' + err.message);
    process.exitCode = 1;
  });
  server.listen(port, HOST, () => {
    log('server_started', 'ok', { port: port });
    log('platform_info', 'info', { platform: process.platform, version: readEngineVersion() });
    const url = 'http://localhost:' + port;
    console.log('');
    console.log('  CyrusAsha_UniversalRTL-1.0.0 Control Panel → ' + url);
    console.log('  (standalone: ' + (isStandalone() ? 'yes' : 'no') + ' — root: ' + ROOT + ')');
    console.log('');
    openBrowser(url);
  });
}

startListening(PORT);

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });

module.exports = { server, listApps };
