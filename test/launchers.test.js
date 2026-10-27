/**
 * تست لانچرهای ویندوز — جلوگیری از باگ «خطای encoding/CRLF»
 * ============================================================================
 * چرا این تست وجود دارد؟
 * ----------------------------------------------------------------------------
 * کاربر ویندوزی گزارش داد که اجرای .bat این خطاها را داد:
 *
 *     'level' is not recognized as an internal or external command
 *     'نسخه‌ی' is not recognized as an internal or external command
 *     Error: Cannot find module '...\windows\src\patcher\patch-electron.js'
 *
 * علت: فایل‌های .bat با پایان‌خط لینوکسی (LF) و متن فارسی (UTF-8) ذخیره
 * شده بودند. cmd.exe ویندوز:
 *   - با LF تنها، خط‌ها را قاطی می‌کند (echo حذف می‌شود و متن اجرا می‌شود)؛
 *   - متن UTF-8 را در بچ‌فایل درست نمی‌خواند.
 *
 * قواعدی که این تست تضمین می‌کند:
 *   ۱. هر فایل .bat فقط ASCII باشد.
 *   ۲. پایان خط همه‌ی .bat/.ps1 فقط CRLF باشد.
 *   ۳. هیچ BOM در ابتدای فایل نباشد.
 *   ۴. خط اول @echo off باشد.
 *   ۵. هر goto :label برچسب متناظر داشته باشد.
 *   ۶. مسیرهای ارجاع‌شده (src\..., release\...) واقعاً وجود داشته باشند.
 *   ۷. مسیرها مطلق باشند (%~dp0..) و به cd وابسته نباشند.
 *
 * Run: node test/launchers.test.js
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const WIN_DIR = path.join(ROOT, 'windows');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; failures.push({ name, error: e }); console.log('  \u2717 ' + name + ' — ' + e.message); }
}

function readRaw(file) { return fs.readFileSync(file); }

/** همه‌ی فایل‌های .bat و .ps1 پروژه (به‌جز node_modules/build) */
function launcherFiles() {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === 'build' || ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, depth + 1);
      else if (/\.(bat|cmd|ps1)$/i.test(ent.name)) out.push(full);
    }
  };
  walk(ROOT, 0);
  return out;
}

const files = launcherFiles();

/* ====================================================================== */
test('all launchers are discovered', () => {
  assert.ok(files.length >= 4, 'expected at least 4 launchers, found: ' + files.map((f) => path.relative(ROOT, f)));
  for (const must of ['start-gui.bat', 'patch.bat', 'diagnose.bat', 'install-shortcut.ps1']) {
    assert.ok(files.some((f) => path.basename(f) === must), 'missing launcher: ' + must);
  }
});

test('.bat files contain ASCII only (no Persian text — cmd cannot parse it)', () => {
  for (const file of files.filter((f) => /\.(bat|cmd)$/i.test(f))) {
    const text = readRaw(file).toString('utf8');
    const offenders = [];
    text.split(/\r?\n/).forEach((line, i) => {
      // eslint-disable-next-line no-control-regex
      if (/[^\x00-\x7F]/.test(line)) offenders.push((i + 1) + ': ' + line.slice(0, 60));
    });
    assert.deepStrictEqual(offenders, [], path.relative(ROOT, file) + ' has non-ASCII lines:\n      ' + offenders.join('\n      '));
  }
});

test('every launcher uses CRLF line endings only', () => {
  for (const file of files) {
    const buf = readRaw(file).toString('utf8');
    const lfOnly = (buf.match(/(^|[^\r])\n/g) || []).length;
    assert.strictEqual(lfOnly, 0, path.relative(ROOT, file) + ' contains ' + lfOnly + ' LF-only line endings (cmd.exe misparses these)');
    assert.ok(buf.includes('\r\n'), path.relative(ROOT, file) + ' must use CRLF');
  }
});

test('no BOM at the start of any launcher', () => {
  for (const file of files) {
    const head = readRaw(file).subarray(0, 3);
    assert.notDeepStrictEqual([...head], [0xEF, 0xBB, 0xBF], path.relative(ROOT, file) + ' starts with a UTF-8 BOM');
  }
});

test('.bat files start with @echo off', () => {
  for (const file of files.filter((f) => /\.(bat|cmd)$/i.test(f))) {
    const first = readRaw(file).toString('utf8').split('\r\n')[0].trim().toLowerCase();
    assert.strictEqual(first, '@echo off', path.relative(ROOT, file) + ' first line is: ' + first);
  }
});

test('every goto :label has a matching label', () => {
  for (const file of files.filter((f) => /\.(bat|cmd)$/i.test(f))) {
    const text = readRaw(file).toString('utf8');
    const gotos = [...text.matchAll(/\bgoto\s+:?([A-Za-z0-9_]+)/gi)].map((m) => m[1].toLowerCase());
    const labels = [...text.matchAll(/^\s*:([A-Za-z0-9_]+)/gm)].map((m) => m[1].toLowerCase());
    for (const g of new Set(gotos)) {
      assert.ok(labels.includes(g), path.relative(ROOT, file) + ' jumps to missing label :' + g);
    }
  }
});

test('launchers avoid relying on the current directory (absolute %~dp0.. paths)', () => {
  const gui = readRaw(path.join(WIN_DIR, 'start-gui.bat')).toString('utf8');
  const pat = readRaw(path.join(WIN_DIR, 'patch.bat')).toString('utf8');
  // دستور node باید با مسیر مطلق صدا زده شود، نه مسیر نسبی
  assert.ok(/node\s+"%~dp0\.\.\\src\\gui\\server\.js"/.test(gui),
    'start-gui.bat must call node with an absolute path');
  assert.ok(/node\s+"%~dp0\.\.\\src\\patcher\\patch-electron\.js"/.test(pat),
    'patch.bat must call node with an absolute path');
});

test('paths referenced by launchers really exist', () => {
  const refs = [
    'src/gui/server.js',
    'src/patcher/patch-electron.js',
    'src/engine/rtl-engine.js',
    'src/gui/public/index.html',
    'vscode-extension/package.json'
  ];
  for (const rel of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), 'referenced file does not exist: ' + rel);
  }
});

test('portable Start.bat template is also ASCII + CRLF', () => {
  const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'build-windows-exe.js'), 'utf8');
  const block = builder.slice(builder.indexOf("'Start.bat'"), builder.indexOf("'README-Windows.txt'"));
  assert.ok(block.length > 50, 'Start.bat block not found in build-windows-exe.js');

  // ۱. محتوای بچ باید ASCII باشد (خطوطی که echo می‌شوند)
  const startLines = (block.match(/'(@echo off|chcp 65001 >nul|cd \/d "%~dp0"|exit)'/g) || []);
  assert.ok(startLines.length >= 4, 'Start.bat content looks incomplete: ' + startLines.join(' | '));
  assert.ok(block.includes("'start \"\" \"%~dp0' + APP_EXE + '\"'"), 'Start.bat must launch the versioned product executable');

  // ۲. همه‌ی خطوط با CRLF به هم وصل می‌شوند
  assert.ok(/join\('\\r\\n'\)/.test(block), 'Start.bat must be joined with CRLF');

  // ۳. اگر پوشه‌ی portable ساخته شده باشد، فایل واقعی را هم بررسی کن
  const portableDir = path.join(ROOT, 'build', 'win');
  if (fs.existsSync(portableDir)) {
    const candidates = fs.readdirSync(portableDir).filter((d) => d.startsWith('CyrusAsha_UniversalRTL-'));
    for (const dirName of candidates) {
      const startFile = path.join(portableDir, dirName, 'Start.bat');
      if (!fs.existsSync(startFile)) continue;
      const buf = fs.readFileSync(startFile, 'utf8');
      assert.ok(!/[^\x00-\x7F]/.test(buf), 'built Start.bat must be ASCII');
      assert.ok(!/(^|[^\r])\n/.test(buf), 'built Start.bat must use CRLF');
      assert.ok(buf.startsWith('@echo off'), 'built Start.bat must start with @echo off');
    }
  }
});

test('control panel launcher documents the portable fallback when Node is missing', () => {
  const gui = readRaw(path.join(WIN_DIR, 'start-gui.bat')).toString('utf8');
  assert.ok(/portable/i.test(gui), 'must mention the portable build');
  assert.ok(/nodejs\.org/.test(gui), 'must point to nodejs.org');
  assert.ok(/CyrusAsha_UniversalRTL-\*-win-x64\.zip/.test(gui), 'must name the portable zip');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) {
  failures.forEach((f) => console.error('FAILED: ' + f.name + '\n' + f.error.stack + '\n'));
  process.exit(1);
}
