#!/usr/bin/env node
/**
 * build-windows-exe.js — ساخت نسخه‌ی ویندوزی بدون نیاز به نصب Node.js
 * ============================================================================
 * چه کاری انجام می‌دهد؟
 * ----------------------------------------------------------------------------
 * یک فایل اجرایی ویندوزی (CyrusAsha_UniversalRTL.exe) می‌سازد که «خودش Node است»:
 * کد ما داخل خود فایل اجرایی بسته‌بندی می‌شود، پس کاربر نهایی فقط روی
 * exe دوبار کلیک می‌کند و مرورگر باز می‌شود — بدون npm، بدون ترمینال.
 *
 * روش کار (Node.js SEA — Single Executable Application):
 *   ۱. کد ما با esbuild در یک فایل JS واحد بسته‌بندی می‌شود.
 *   ۲. Node یک «بلاب» مخصوص SEA از آن می‌سازد (--experimental-sea-config).
 *   ۳. node.exe رسمی ویندوز دانلود می‌شود.
 *   ۴. بلاب با postject داخل node.exe تزریق می‌شود → CyrusAsha_UniversalRTL.exe
 *   ۵. همه‌ی فایل‌های لازم کنار exe در یک پوشه‌ی portable چیده می‌شوند
 *      (موتور RTL، فایل‌های UI، ابزار ساخت VSIX …).
 *   ۶. پیش از بسته‌بندی، userscript، VSIX و بسته‌های Chrome/Firefox ساخته
 *      می‌شوند تا نسخه‌ی portable دقیقاً همان خروجی 1.0.0 را همراه داشته باشد.
 *   ۷. کل پوشه در release/windows/ به ZIP تبدیل می‌شود.
 *
 * اجرا:
 *   npm run build:win
 *
 * پیش‌نیاز: اینترنت (فقط برای دانلود node.exe رسمی از nodejs.org).
 * ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build', 'win');
const OUT_DIR = path.join(ROOT, 'release', 'windows');

/* نسخه‌ی Node که داخل exe می‌رود. LTS است تا پایدار بماند. */
const NODE_VERSION = process.env.RTL_NODE_VERSION || 'v20.18.0';
/* نسخه‌ی پروژه از package.json خوانده می‌شود. */
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PRODUCT_NAME = 'CyrusAsha_UniversalRTL';
const PRODUCT_TITLE = PRODUCT_NAME + '-' + PKG.version;
const APP_EXE = PRODUCT_TITLE + '.exe';

function log(msg) { console.log('  ' + msg); }
function step(msg) { console.log('\n▶ ' + msg); }

/* ------------------------------------------------------------------ *
 * ۱. بسته‌بندی کد در یک فایل
 * ------------------------------------------------------------------ */
function bundle() {
  step('بسته‌بندی کد (esbuild)');
  fs.mkdirSync(BUILD, { recursive: true });
  const esbuild = require('esbuild');
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src', 'gui', 'server.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: path.join(BUILD, 'bundle.js'),
    legalComments: 'none',
    logLevel: 'warning'
  });
  const size = fs.statSync(path.join(BUILD, 'bundle.js')).size;
  log('bundle.js → ' + Math.round(size / 1024) + ' KB');
}

/* ------------------------------------------------------------------ *
 * ۲. ساخت بلاب SEA
 * ------------------------------------------------------------------ */
function makeSeaBlob() {
  step('ساخت بلاب Node SEA');
  const configPath = path.join(BUILD, 'sea-config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    main: path.join(BUILD, 'bundle.js'),
    output: path.join(BUILD, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true
  }, null, 2));

  const res = spawnSync(process.execPath, ['--experimental-sea-config', configPath], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error('SEA blob failed: ' + (res.stderr || res.stdout));
  const blob = path.join(BUILD, 'sea-prep.blob');
  log('sea-prep.blob → ' + Math.round(fs.statSync(blob).size / 1024) + ' KB');
  return blob;
}

/* ------------------------------------------------------------------ *
 * ۳. دانلود node.exe رسمی ویندوز
 * ------------------------------------------------------------------ */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.rmSync(dest, { force: true });
        return download(new URL(res.headers.location, url).toString(), dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', reject);
  });
}

function unzip(zipPath, destDir) {
  // روی ویندوز از PowerShell و در لینوکس/مک از unzip استفاده می‌کنیم.
  if (process.platform === 'win32') {
    const res = spawnSync('powershell', ['-NoProfile', '-Command',
      'Expand-Archive -LiteralPath "' + zipPath + '" -DestinationPath "' + destDir + '" -Force'
    ], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error('Expand-Archive failed: ' + res.stderr);
  } else {
    const res = spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error('unzip failed: ' + res.stderr);
  }
}

/* اندازه‌هایی که ویندوز برای آیکون یک فایل درخواست می‌کند: ۱۶/۳۲ برای لیست و
 * جزئیات، ۴۸/۹۶/۲۵۶ برای نماهای متوسط/بزرگ/خیلی‌بزرگ و ۲۰/۲۴/۴۰/۶۴/۱۲۸ برای
 * نمایشگرهای با مقیاس ۱۲۵٪/۱۵۰٪/۲۰۰٪. نبودِ هر اندازه یعنی ویندوز مجبور است
 * یک فریم دیگر را بزرگ/کوچک کند. */
const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const ICON_REQUIRED = ['16x16', '32x32', '48x48', '256x256'];

/* تغییر اندازه با میانگین ناحیه‌ای (box filter) روی پیکسل‌های premultiplied؛
 * برای کوچک‌کردن‌های زیاد لبه‌های شفاف را سیاه نمی‌کند. */
function resizeLogo(source, size) {
  const { PNG } = require('pngjs');
  const side = Math.min(source.width, source.height);
  const offX = Math.floor((source.width - side) / 2);
  const offY = Math.floor((source.height - side) / 2);
  const dst = new PNG({ width: size, height: size });
  const scale = side / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.max(y0 + 1, Math.min(side, Math.ceil((y + 1) * scale)));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.min(side, Math.ceil((x + 1) * scale)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (((sy + offY) * source.width) + sx + offX) << 2;
          const alpha = source.data[i + 3] / 255;
          r += source.data[i] * alpha;
          g += source.data[i + 1] * alpha;
          b += source.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const o = ((y * size) + x) << 2;
      dst.data[o] = a > 0 ? Math.round(r / a) : 0;
      dst.data[o + 1] = a > 0 ? Math.round(g / a) : 0;
      dst.data[o + 2] = a > 0 ? Math.round(b / a) : 0;
      dst.data[o + 3] = n > 0 ? Math.round((a / n) * 255) : 0;
    }
  }
  return dst;
}

async function makeWindowsIcon() {
  step('ساخت آیکون ویندوز از لوگو');
  const logo = path.join(ROOT, 'assets', 'CyrusAsha_UniversalRTL-logo.png');
  if (!fs.existsSync(logo)) {
    // Failing loudly is deliberate: shipping node.exe's icon is the bug this
    // step exists to prevent, so a missing logo must stop the build.
    throw new Error('لوگوی برنامه پیدا نشد: ' + logo);
  }
  try {
    const { PNG } = require('pngjs');
    // png-to-ico is ESM-only; this file is CommonJS.
    const pngToIco = (await import('png-to-ico')).default;
    const source = PNG.sync.read(fs.readFileSync(logo));
    // آرایه‌ی بافرها: png-to-ico هر تصویر را در اندازه‌ی خودش به یک فریم تبدیل
    // می‌کند؛ پس هیچ تغییر اندازه‌ی داخلی یا افت کیفیتی رخ نمی‌دهد.
    const frames = ICON_SIZES.map((size) => PNG.sync.write(resizeLogo(source, size)));
    const ico = await pngToIco(frames);
    const out = path.join(BUILD, PRODUCT_NAME + '.ico');
    fs.writeFileSync(out, ico);
    if (!ico || ico.length < 1000) throw new Error('ICO output looks empty');
    log(PRODUCT_NAME + '.ico → ' + Math.round(ico.length / 1024) + ' KB (' + ICON_SIZES.length + ' sizes)');
    return out;
  } catch (e) {
    throw new Error('ساخت آیکون از لوگو ناموفق بود: ' + e.message);
  }
}

/* بعد از تزریق بلاب SEA دوباره منابع PE را می‌خوانیم تا مطمئن شویم آیکون
 * و مشخصات نسخه واقعاً داخل فایل نهایی مانده‌اند (postject آن‌ها را بازنویسی نمی‌کند،
 * اما این بررسی جلوی تحویل exe با آیکون Node را می‌گیرد). */
async function verifyWindowsResources(exePath) {
  const ResEdit = await require('resedit/cjs').load();
  const base = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(base);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  const sizes = [];
  for (const group of groups) {
    for (const icon of group.icons) sizes.push((icon.width || 256) + 'x' + (icon.height || 256));
  }
  // چند گروه آیکون (گروه قدیمی node.exe + گروه ما) یعنی ویندوز ممکن است گروه
  // درست را انتخاب نکند؛ پس exe نهایی باید دقیقاً یک گروه داشته باشد.
  if (groups.length !== 1) {
    throw new Error('exe must contain exactly one icon group, found ' + groups.length);
  }
  const unique = Array.from(new Set(sizes));
  for (const need of ICON_REQUIRED) {
    if (unique.indexOf(need) === -1) {
      throw new Error('icon group is missing the ' + need + ' frame: ' + unique.join(', '));
    }
  }
  return { sizes: unique, groups: groups.length };
}

async function getNodeExe() {
  step('تهیه node.exe ویندوز (' + NODE_VERSION + ')');
  const cached = path.join(os.tmpdir(), 'rtl-node-' + NODE_VERSION + '-win-x64.exe');
  if (fs.existsSync(cached) && fs.statSync(cached).size > 20 * 1024 * 1024) {
    log('از کش استفاده می‌شود: ' + cached);
    return cached;
  }
  const zipName = 'node-' + NODE_VERSION + '-win-x64.zip';
  const url = 'https://nodejs.org/dist/' + NODE_VERSION + '/' + zipName;
  const zipPath = path.join(os.tmpdir(), zipName);
  log('دانلود ' + url);
  await download(url, zipPath);

  const extractDir = path.join(os.tmpdir(), 'rtl-node-extract-' + Date.now());
  fs.mkdirSync(extractDir, { recursive: true });
  unzip(zipPath, extractDir);
  const exe = path.join(extractDir, 'node-' + NODE_VERSION + '-win-x64', 'node.exe');
  if (!fs.existsSync(exe)) throw new Error('node.exe not found after extraction');
  fs.copyFileSync(exe, cached);
  fs.rmSync(zipPath, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });
  log('node.exe → ' + Math.round(fs.statSync(cached).size / 1024 / 1024) + ' MB');
  return cached;
}

/* ------------------------------------------------------------------ *
 * ۴. تزریق بلاب داخل node.exe
 * ------------------------------------------------------------------ */
async function writeBaseExecutable(nodeExe, outExe, icoPath) {
  step('افزودن آیکون و مشخصات ویندوز');
  const ResEdit = await require('resedit/cjs').load();
  const base = ResEdit.NtExecutable.from(fs.readFileSync(nodeExe), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(base);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  const group = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    group.id,
    group.lang,
    iconFile.icons.map((item) => item.data)
  );

  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (versions.length) {
    const vi = versions[0];
    const parts = String(PKG.version).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
    const [a = 0, b = 0, c = 0, d = 0] = parts;
    vi.setFileVersion(a, b, c, d, 1033);
    vi.setProductVersion(a, b, c, d, 1033);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      CompanyName: 'CyrusAsha',
      ProductName: 'CyrusAsha UniversalRTL',
      FileDescription: 'CyrusAsha UniversalRTL - Smart RTL for AI agents',
      FileVersion: PKG.version,
      ProductVersion: PKG.version,
      OriginalFilename: APP_EXE,
      InternalName: PRODUCT_NAME,
      LegalCopyright: 'MIT License'
    });
    vi.outputToResourceEntries(resources.entries);
  }

  resources.outputResource(base);
  fs.writeFileSync(outExe, Buffer.from(base.generate()));
  log('آیکون و مشخصات نسخه اعمال شد');
}

async function inject(nodeExe, blobPath, outExe, icoPath) {
  // The branded icon is part of the product: never fall back to node.exe's.
  if (!icoPath) throw new Error('آیکون ویندوز ساخته نشد؛ ساخت متوقف شد');
  await writeBaseExecutable(nodeExe, outExe, icoPath);
  step('تزریق بلاب داخل node.exe (postject)');
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js'),
    outExe,
    'NODE_SEA_BLOB', blobPath,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
  ], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error('postject failed: ' + (res.stderr || res.stdout));
  const header = Buffer.alloc(2);
  const fd = fs.openSync(outExe, 'r');
  fs.readSync(fd, header, 0, 2, 0);
  fs.closeSync(fd);
  if (header.toString() !== 'MZ') throw new Error('output is not a Windows PE executable');
  const icon = await verifyWindowsResources(outExe);
  log('آیکون داخل فایل نهایی ✓ (یک گروه، ' + icon.sizes.length + ' اندازه: ' + icon.sizes.join(', ') + ')');
  log(APP_EXE + ' → ' + Math.round(fs.statSync(outExe).size / 1024 / 1024) + ' MB (PE ✓)');
  return outExe;
}

/* ------------------------------------------------------------------ *
 * ۵. چیدن پوشه‌ی portable
 * ------------------------------------------------------------------ */
const COPY_SKIP = new Set(['.agents', '.git', '.freebuff', 'node_modules', '.cache', 'coverage', '__pycache__']);
function copyIfExists(src, destDir, rel) {
  if (!fs.existsSync(src)) return;
  const dest = path.join(destDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (from) => !COPY_SKIP.has(path.basename(from))
  });
}

function assemblePortable(exePath) {
  step('چیدن پوشه‌ی portable');
  const name = PRODUCT_TITLE + '-win-x64';
  const dir = path.join(BUILD, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  fs.copyFileSync(exePath, path.join(dir, APP_EXE));

  // فایل‌هایی که exe در زمان اجرا لازم دارد
  copyIfExists(path.join(ROOT, 'src', 'engine'), dir, path.join('src', 'engine'));
  copyIfExists(path.join(ROOT, 'src', 'gui', 'public'), dir, path.join('src', 'gui', 'public'));
  copyIfExists(path.join(ROOT, 'src', 'patcher'), dir, path.join('src', 'patcher'));
  copyIfExists(path.join(ROOT, 'src', 'shared'), dir, path.join('src', 'shared'));
  copyIfExists(path.join(ROOT, 'vscode-extension'), dir, 'vscode-extension');
  copyIfExists(path.join(ROOT, 'browser-extension'), dir, 'browser-extension');
  copyIfExists(path.join(ROOT, 'tools'), dir, 'tools');
  copyIfExists(path.join(ROOT, 'scripts', 'build-assets.js'), dir, path.join('scripts', 'build-assets.js'));
  copyIfExists(path.join(ROOT, 'scripts', 'build-browser-extension.js'), dir, path.join('scripts', 'build-browser-extension.js'));
  copyIfExists(path.join(ROOT, 'scripts', 'build-chrome-crx.js'), dir, path.join('scripts', 'build-chrome-crx.js'));
  copyIfExists(path.join(ROOT, 'demo', 'index.html'), dir, path.join('demo', 'index.html'));
  copyIfExists(path.join(ROOT, 'demo', 'demo.template.html'), dir, path.join('demo', 'demo.template.html'));
  copyIfExists(path.join(ROOT, 'package.json'), dir, 'package.json');
  copyIfExists(path.join(ROOT, 'release'), dir, 'release');
  copyIfExists(path.join(ROOT, 'LICENSE'), dir, 'LICENSE');
  copyIfExists(path.join(ROOT, 'README.md'), dir, 'README.md');

  // node_modules لازم نیست؛ فقط ابزار ساخت VSIX از tools/zip استفاده می‌کند.
  fs.rmSync(path.join(dir, 'release', 'windows'), { recursive: true, force: true });
  // The portable release ships packed browser files only; source/unpacked build
  // folders remain in the project for linting and development workflows.
  fs.rmSync(path.join(dir, 'release', 'browser', 'chrome-unpacked'), { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'release', 'browser', 'firefox-unpacked'), { recursive: true, force: true });

  // لانچر دوبار-کلیک
  fs.writeFileSync(path.join(dir, 'Start.bat'), [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'start "" "%~dp0' + APP_EXE + '"',
    'exit'
  ].join('\r\n') + '\r\n', 'utf8');

  // راهنمای سریع دوزبانه
  fs.writeFileSync(path.join(dir, 'README-Windows.txt'), [
    PRODUCT_TITLE + ' — Windows (portable)',
    '==============================================',
    '',
    'EN: Double-click Start.bat (or ' + APP_EXE + ').',
    '    Node.js is NOT required — it is bundled inside the exe.',
    '    The control panel opens in your browser at http://localhost:4477',
    '    If the port is busy, the next free port is used automatically.',
    '    For apps under Program Files, run this tool as Administrator and',
    '    fully close the target app before patching it.',
    '',
    'FA: روی Start.bat (یا ' + APP_EXE + ') دوبار کلیک کن.',
    '    به Node.js نیازی نیست — داخل خود exe هست.',
    '    مرکز کنترل در مرورگر باز می‌شود: http://localhost:4477',
    '    اگر پورت اشغال باشد، پورت بعدی آزاد خودکار انتخاب می‌شود.',
    '    برای برنامه‌های داخل Program Files، ابزار را با Administrator اجرا کن',
    '    و قبل از پچ، برنامه‌ی هدف را کامل ببند.',
    '',
    'Icon cache / کش آیکون:',
    '  EN: If Explorer shows an old icon for the exe (for example the green',
    '      Node icon) while Properties shows the right one, the shell cache is',
    '      stale. Extract this ZIP into a folder name you have not used before,',
    '      or run:  ie4uinit.exe -show',
    '  FA: اگر Explorer برای exe آیکون قدیمی (مثلاً سبز Node) نشان می‌دهد ولی',
    '      Properties درست است، کش ویندوز کهنه شده؛ ZIP را در پوشه‌ای با نام',
    '      تازه باز کن یا این را اجرا کن:  ie4uinit.exe -show',
    '',
    'Firefox extension / افزونه‌ی Firefox:',
    '  https://addons.mozilla.org/en-US/firefox/addon/cyrusasha_universalrtl/',
    '',
    'Uninstall / حذف:',
    '  EN: Just delete this folder. For apps that were patched, use the',
    '      "Unpatch" button in the control panel first.',
    '  FA: همین پوشه را پاک کن. برای برنامه‌هایی که پچ شدند، اول دکمه‌ی',
    '      «حذف پچ» را در مرکز کنترل بزن.',
    '',
    'License: MIT · https://github.com/rtl-universal'
  ].join('\r\n') + '\r\n', 'utf8');

  log('پوشه آماده: ' + path.relative(ROOT, dir));
  return dir;
}

/* ------------------------------------------------------------------ *
 * ۶. ساخت ZIP (بدون ابزار خارجی، با tools/zip.js)
 * ------------------------------------------------------------------ */
function collect(dir, base) {
  const entries = [];
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const r = rel ? rel + '/' + name : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, r);
      else entries.push({ name: base + '/' + r, data: fs.readFileSync(full) });
    }
  };
  walk(dir, '');
  return entries;
}

function zipFolder(dir, zipPath) {
  step('ساخت فایل ZIP');
  const { createZip } = require(path.join(ROOT, 'tools', 'zip.js'));
  const base = path.basename(dir);
  const entries = collect(dir, base);

  // exe بزرگ است؛ فشرده‌سازی سنگین کند می‌شود. tools/zip از level 9 استفاده
  // می‌کند که برای ~۸۰ مگابایت هنوز چند ثانیه بیشتر نیست.
  createZip(entries, zipPath);
  const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  log('ZIP → release/windows/' + path.basename(zipPath) + ' (' + mb + ' MB)');
  return zipPath;
}

/* ------------------------------------------------------------------ *
 * ساخت منابعی که مرکز کنترل داخل portable zip دانلود/نمایش می‌دهد.
 * این مرحله باعث می‌شود build:win به خروجی قدیمی یا از قبل ساخته‌شده تکیه نکند.
 * ------------------------------------------------------------------ */
function pruneObsoleteReleasePackages() {
  // Release contains only versioned files for this first branded release.
  // Also recognize legacy 1.3.0 filenames so they cannot leak into the new ZIP.
  const keep = new Set([
    'cyrusasha.universalrtl-' + PKG.version + '.vsix',
    'CyrusAsha_UniversalRTL-' + PKG.version + '-Chrome.crx',
    'CyrusAsha_UniversalRTL-' + PKG.version + '-Chrome.zip',
    'CyrusAsha_UniversalRTL-' + PKG.version + '-Firefox.xpi',
    'CyrusAsha_UniversalRTL-' + PKG.version + '-win-x64.zip'
  ]);
  const checks = [
    { dir: path.join(ROOT, 'release'), pattern: /^(?:rtl-universal|universalrtl|cyrusasha\.universalrtl)-(\d+\.\d+\.\d+)\.vsix$/i },
    { dir: path.join(ROOT, 'release', 'browser'), pattern: /^(?:RTL-Universal|CyrusAsha_UniversalRTL)-(\d+\.\d+\.\d+)-(?:Chrome\.(?:zip|crx)|Firefox\.xpi)$/i },
    { dir: path.join(ROOT, 'release', 'windows'), pattern: /^(?:RTL-Universal|CyrusAsha_UniversalRTL)-(\d+\.\d+\.\d+)-win-x64\.zip$/i }
  ];
  for (const check of checks) {
    if (!fs.existsSync(check.dir)) continue;
    for (const name of fs.readdirSync(check.dir)) {
      if (check.pattern.test(name) && !keep.has(name)) {
        const file = path.join(check.dir, name);
        fs.rmSync(file, { force: true });
        log('حذف بسته‌ی قدیمی یا با نام قبلی: ' + path.relative(ROOT, file));
      }
    }
  }
}

async function prepareReleaseArtifacts() {
  step('ساخت خروجی‌های نسخه‌دار برای بسته‌ی portable');
  require(path.join(ROOT, 'scripts', 'build-assets.js')).main();
  require(path.join(ROOT, 'vscode-extension', 'build-vsix.js')).main();
  require(path.join(ROOT, 'scripts', 'build-browser-extension.js')).main();
  await require(path.join(ROOT, 'scripts', 'build-chrome-crx.js')).buildChromeCrx();
  pruneObsoleteReleasePackages();
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */
(async function main() {
  console.log('\n' + PRODUCT_TITLE + ' — Windows build\n');

  try {
    await prepareReleaseArtifacts();
    bundle();
    const blob = makeSeaBlob();
    const nodeExe = await getNodeExe();
    const ico = await makeWindowsIcon();
    const exe = await inject(nodeExe, blob, path.join(BUILD, APP_EXE), ico);
    const dir = assemblePortable(exe);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const zip = path.join(OUT_DIR, PRODUCT_TITLE + '-win-x64.zip');
    zipFolder(dir, zip);

    // پاک‌سازی فایل‌های میانی سنگین (exe بدون zip نگه داشته نمی‌شود تا حجم کم بماند)
    fs.rmSync(exe, { force: true });
    console.log('\n✅ آماده است: release/windows/' + path.basename(zip));
    console.log('   کاربر فقط ZIP را باز می‌کند و Start.bat را اجرا می‌کند.\n');
  } catch (e) {
    console.error('\n❌ ساخت ناموفق: ' + e.message + '\n');
    process.exitCode = 1;
  }
})();
