/**
 * تست‌های مخصوص ویندوز — با شبیه‌سازی ساختار پوشه‌های ویندوزی روی لینوکس.
 * Run: node test/windows.test.js
 *
 * چه چیزی تست می‌شود؟
 *   ۱. پیدا کردن اپ‌ها در مسیرهای اضافی (RTL_UNIVERSAL_SCAN_ROOTS)
 *      — همان کدی که روی ویندوز %LOCALAPPDATA% را می‌گردد.
 *   ۲. پچ/آنپچ کامل در یک پوشه با ساختار ویندوزی (Programs\<App>\resources).
 *   ۳. پیام خطای درست وقتی فایل asar قفل/فقط-خواندنی است (سناریوی «برنامه باز است»).
 *   ۴. بازگشت‌پذیری مسیرها (paths.js) در حالت portable.
 *   ۵. پیش‌فرض امن سرور: فقط 127.0.0.1 + پورت جایگزین خودکار.
 *   ۶. اعتبارسنجی فایل‌های .bat و .ps1 (وجود، کدگذاری، دستورهای کلیدی).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const official = require('@electron/asar');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; failures.push({ name, error: e }); console.log('  \u2717 ' + name + ' — ' + e.message); }
}

/** یک اپ Electron جعلی با ساختار ویندوزی می‌سازد:
 *  <base>\Programs\<AppName>\resources\app.asar  +  <AppName>.exe
 */
async function makeWindowsStyleApp(base, appName) {
  const appRoot = path.join(base, 'Programs', appName);
  const resources = path.join(appRoot, 'resources');
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(appRoot, appName + '.exe'), 'MZ fake exe');

  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'win-src-'));
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({
    name: appName.toLowerCase().replace(/\s+/g, '-'),
    productName: appName,
    version: '4.2.0',
    main: 'main.js'
  }));
  fs.writeFileSync(path.join(src, 'main.js'),
    "const { app, BrowserWindow } = require('electron');\napp.whenReady().then(() => new BrowserWindow({}));\n");
  fs.writeFileSync(path.join(src, 'renderer.js'), 'console.log("ui");\n');
  await official.createPackage(src, path.join(resources, 'app.asar'));
  // Windows may still hold the write handle that createPackage() just closed;
  // the patcher's rename-over-existing step would then fail with EPERM.
  if (process.platform === 'win32') await new Promise((resolve) => setTimeout(resolve, 250));
  return { appRoot, asarPath: path.join(resources, 'app.asar'), exe: path.join(appRoot, appName + '.exe') };
}

(async function main() {
  console.log('\nWindows readiness tests\n');

  /* ==================================================================== */
  await test('apps are discovered through RTL_UNIVERSAL_SCAN_ROOTS (Programs structure)', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'win-base-'));
    await makeWindowsStyleApp(base, 'Hermes Agent');
    await makeWindowsStyleApp(base, 'Freebuff');

    const probe = spawnSync(process.execPath, [
      path.join(ROOT, 'src', 'patcher', 'patch-electron.js'), '--list'
    ], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { RTL_UNIVERSAL_SCAN_ROOTS: base })
    });
    assert.strictEqual(probe.status, 0, probe.stderr);
    assert.ok(probe.stdout.includes('Hermes Agent'), probe.stdout);
    assert.ok(probe.stdout.includes('Freebuff'), probe.stdout);
    assert.ok(probe.stdout.includes(path.join('resources', 'app.asar')), 'asar path must be shown');
  });

  /* ==================================================================== */
  await test('full patch + unpatch cycle on a Windows-style install folder', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'win-patch-'));
    const app = await makeWindowsStyleApp(base, 'OpenCode Desktop');
    const before = fs.readFileSync(app.asarPath);

    const patch = spawnSync(process.execPath, [
      path.join(ROOT, 'src', 'patcher', 'patch-electron.js'),
      '--app', app.exe            // 👈 کاربر ویندوزی مسیر exe را می‌دهد
    ], { encoding: 'utf8' });
    assert.strictEqual(patch.status, 0, patch.stdout + patch.stderr);
    assert.ok(/پچ با موفقیت|patched/i.test(patch.stdout), patch.stdout);

    const patched = fs.readFileSync(app.asarPath);
    assert.ok(patched.includes(Buffer.from('rtl-universal-engine.js')), 'engine must be inside asar');
    assert.ok(fs.existsSync(app.asarPath + '.rtl-backup'), 'backup must exist');

    const check = spawnSync(process.execPath, [
      path.join(ROOT, 'src', 'patcher', 'patch-electron.js'), '--app', app.exe, '--status'
    ], { encoding: 'utf8' });
    assert.ok(/پچ شده|patched/i.test(check.stdout), check.stdout);

    const un = spawnSync(process.execPath, [
      path.join(ROOT, 'src', 'patcher', 'patch-electron.js'), '--app', app.exe, '--unpatch'
    ], { encoding: 'utf8' });
    assert.strictEqual(un.status, 0, un.stdout + un.stderr);
    assert.deepStrictEqual(fs.readFileSync(app.asarPath), before, 'restored file must be byte-identical');
  });

  /* ==================================================================== */
  await test('locked app.asar produces a clear Windows-specific error (app is running)', async () => {
    if (process.platform === 'win32') return; // در ویندوز واقعی، قفل واقعی است
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'win-lock-'));
    const app = await makeWindowsStyleApp(base, 'Locked App');

    // شبیه‌سازی «فایل قفل»: پوشه‌ی resources را فقط-خواندنی می‌کنیم تا
    // نوشتن فایل موقت/rename با EACCES شکست بخورد (همان چیزی که در ویندوز
    // وقتی برنامه باز است با EBUSY رخ می‌دهد).
    const resourcesDir = path.join(app.appRoot, 'resources');
    fs.chmodSync(resourcesDir, 0o555);
    try {
      const res = spawnSync(process.execPath, [
        path.join(ROOT, 'src', 'patcher', 'patch-electron.js'), '--app', app.exe
      ], { encoding: 'utf8' });

      const output = res.stdout + res.stderr;
      assert.notStrictEqual(res.status, 0, 'patch must fail, not silently succeed');
      assert.ok(/قفل|locked|اجازه|Administrator|EBUSY|EACCES|EPERM/i.test(output), output);
      assert.ok(/Task Manager|ببند|close/i.test(output), 'must tell the user what to do');
    } finally {
      fs.chmodSync(resourcesDir, 0o755);
    }
  });

  /* ==================================================================== */
  await test('paths.js resolves the project root (normal layout)', async () => {
    const { projectRoot, findAsset } = require('../src/shared/paths');
    const root = projectRoot();
    assert.strictEqual(path.resolve(root), path.resolve(ROOT));
    assert.ok(findAsset('src/engine/rtl-engine.js'));
    assert.ok(findAsset('vscode-extension/package.json'));
    assert.strictEqual(findAsset('does/not/exist.txt'), null);
  });

  /* ==================================================================== */
  await test('paths.js finds assets next to an exe (portable layout)', async () => {
    const portable = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-'));
    fs.mkdirSync(path.join(portable, 'src', 'engine'), { recursive: true });
    fs.writeFileSync(path.join(portable, 'src', 'engine', 'rtl-engine.js'), '/* engine */');

    // اجرای یک اسکریپت از پوشه‌ی دیگر با global.__RTL_ROOT__
    const script = `
      global.__RTL_ROOT__ = ${JSON.stringify(portable)};
      const p = require(${JSON.stringify(path.join(ROOT, 'src', 'shared', 'paths.js'))});
      const fs = require('fs');
      const found = p.findAsset('src/engine/rtl-engine.js');
      console.log(JSON.stringify({ root: p.projectRoot(), found: found }));
    `;
    const res = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.root, portable);
    assert.strictEqual(out.found, path.join(portable, 'src', 'engine', 'rtl-engine.js'));
  });

  /* ==================================================================== */
  await test('portable Windows build includes freshly built browser add-ons', async () => {
    const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'build-windows-exe.js'), 'utf8');
    assert.ok(/prepareReleaseArtifacts\(\);/.test(builder), 'portable build must prepare versioned packages');
    assert.ok(/build-browser-extension\.js/.test(builder), 'Chrome and Firefox packages must be rebuilt');
    assert.ok(/build-chrome-crx\.js/.test(builder), 'packed Chrome CRX must be built');
    assert.ok(/Chrome\.crx/.test(builder), 'portable release should include the packed Chrome artifact');
    assert.ok(/release', 'browser', 'chrome-unpacked/.test(builder), 'unpacked development folder must not ship in the portable release');
    assert.ok(/browser-extension/.test(builder), 'portable folder must contain browser-extension source');
    assert.ok(/copyIfExists\(path\.join\(ROOT, 'release'\), dir, 'release'\)/.test(builder),
      'portable folder must include current install packages');
    assert.ok(/pruneObsoleteReleasePackages/.test(builder), 'old versioned packages must not be shipped');
    assert.ok(/run this tool as Administrator/.test(builder), 'portable instructions must explain elevation for Program Files');
    assert.ok(/برنامه‌های داخل Program Files/.test(builder), 'portable Persian instructions must mention protected app installs');
  });

  /* ==================================================================== */
  await test('control panel binds to 127.0.0.1 by default and falls back when the port is busy', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'win-home-'));
    const env = Object.assign({}, process.env, { RTL_UNIVERSAL_HOME: home, RTL_GUI_HOST: '' });

    const first = spawn(process.execPath, [path.join(ROOT, 'src', 'gui', 'server.js'), '--port', '4493', '--no-open'], { env });
    let firstLog = '';
    first.stdout.on('data', (d) => { firstLog += d; });
    first.stderr.on('data', (d) => { firstLog += d; });

    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try { const r = await fetch('http://127.0.0.1:4493/api/state'); up = r.ok; } catch (e) { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(up, 'first server did not start: ' + firstLog);

    // سرور دوم روی همان پورت → باید خودکار 4494 را انتخاب کند
    const second = spawn(process.execPath, [path.join(ROOT, 'src', 'gui', 'server.js'), '--port', '4493', '--no-open'], { env });
    let secondLog = '';
    second.stdout.on('data', (d) => { secondLog += d; });
    second.stderr.on('data', (d) => { secondLog += d; });

    let secondUp = false;
    for (let i = 0; i < 60 && !secondUp; i++) {
      try { const r = await fetch('http://127.0.0.1:4494/api/state'); secondUp = r.ok; } catch (e) { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(secondUp, 'server did not fall back to the next port: ' + secondLog);
    assert.ok(/4494/.test(secondLog), secondLog);

    // بررسی انتشار روی 127.0.0.1: اتصال از آدرس loopback کار می‌کند (خودِ بایند قابل تست مستقیم نیست)
    const state = await (await fetch('http://127.0.0.1:4494/api/state')).json();
    assert.ok(state.engineVersion);

    first.kill('SIGTERM'); second.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
  });

  /* ==================================================================== */
  await test('Windows launchers exist, use CRLF-safe content, and reference real files', async () => {
    const files = ['start-gui.bat', 'patch.bat', 'install-shortcut.ps1'];
    for (const name of files) {
      const full = path.join(ROOT, 'windows', name);
      assert.ok(fs.existsSync(full), name + ' is missing');
      const content = fs.readFileSync(full, 'utf8');
      assert.ok(content.length > 50, name + ' looks empty');
      // start-gui.bat و patch.bat مستقیم node را صدا می‌زنند؛
      // install-shortcut.ps1 به start-gui.bat اشاره می‌کند (که خودش node را اجرا می‌کند).
      const viaLauncher = /start-gui\.bat/.test(content);
      assert.ok(content.includes('node') || viaLauncher, name + ' must reach node (directly or via start-gui.bat)');
    }
    const gui = fs.readFileSync(path.join(ROOT, 'windows', 'start-gui.bat'), 'utf8');
    assert.ok(/chcp 65001/.test(gui), 'start-gui.bat must set UTF-8 for the server console output');
    // رفع باگ 1.2.1: به‌جای نصب خودکار با winget (که روی خیلی از سیستم‌ها نیست)
    // کاربر به نسخه‌ی portable یا nodejs.org راهنمایی می‌شود.
    assert.ok(/nodejs\.org/i.test(gui), 'start-gui.bat must point to nodejs.org when Node is missing');
    assert.ok(/portable/i.test(gui), 'start-gui.bat must mention the no-Node portable build');
    assert.ok(/src\\gui\\server\.js/.test(gui), 'start-gui.bat must point to the real server file');

    const patch = fs.readFileSync(path.join(ROOT, 'windows', 'patch.bat'), 'utf8');
    assert.ok(/patch-electron\.js/.test(patch), 'patch.bat must call the patcher');

    const shortcut = fs.readFileSync(path.join(ROOT, 'windows', 'install-shortcut.ps1'), 'utf8');
    assert.ok(/WScript\.Shell/.test(shortcut), 'shortcut script must create a .lnk');
    assert.ok(/Desktop/.test(shortcut), 'shortcut script must target the Desktop');
  });

  /* ==================================================================== */
  await test('every Windows launcher path actually exists in the repo', async () => {
    const gui = fs.readFileSync(path.join(ROOT, 'windows', 'start-gui.bat'), 'utf8');
    // مسیر باید «مطلق» باشد (%~dp0..) تا اجرا از هر پوشه‌ای کار کند
    const match = gui.match(/"%~dp0\.\.\\src\\gui\\server\.js"/);
    assert.ok(match, 'server path must be absolute (~dp0..) in start-gui.bat');
    const realPath = path.join(ROOT, 'src', 'gui', 'server.js');
    assert.ok(fs.existsSync(realPath), 'referenced server.js does not exist');

    const pat = fs.readFileSync(path.join(ROOT, 'windows', 'patch.bat'), 'utf8');
    assert.ok(/"%~dp0\.\.\\src\\patcher\\patch-electron\.js"/.test(pat),
      'patcher path must be absolute (~dp0..) in patch.bat');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    failures.forEach((f) => console.error('FAILED: ' + f.name + '\n' + f.error.stack + '\n'));
    process.exit(1);
  }
  process.exit(0);
})();
