/**
 * CyrusAsha_UniversalRTL-1.0.0 — extension for VS Code-family IDEs:
 * VS Code · VSCodium · Antigravity · Cursor · Windsurf · Kiro · Devin · Trae…
 *
 * How it works (same architecture as the well-known workbench RTL tools):
 * VS Code extensions cannot execute arbitrary JS in the workbench window, so we
 * append a small, clearly-marked bootstrap block to the workbench bundle on disk:
 *
 *     resources/app/out/vs/workbench/workbench.desktop.main.js
 *
 * The block contains the CyrusAsha_UniversalRTL-1.0.0 engine (media/rtl-engine.js) + the user
 * configuration. A backup is created once, the patch is written atomically, and
 * it is re-applied automatically after IDE updates (when the bundle is replaced).
 *
 * Uninstall/disable restores the backup (or strips the marked block surgically).
 */
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/* ============================================================================
 * این افزونه چطور کار می‌کند؟ (توضیح برای تازه‌کار)
 * ----------------------------------------------------------------------------
 * VS Code (و فورک‌هایش مثل Antigravity/Cursor) اجازه نمی‌دهد یک افزونه کد
 * دلخواه را داخل پنجره‌ی اصلی (Workbench) اجرا کند — این یک محدودیت امنیتی است.
 *
 * همه‌ی ابزارهای شناخته‌شده‌ی RTL هم به همین دلیل کار دیگری می‌کنند:
 * فایل بسته‌ی Workbench روی دیسک را «پچ» می‌کنند:
 *
 *     <appRoot>/out/vs/workbench/workbench.desktop.main.js
 *
 * ما یک بلوک کاملاً علامت‌گذاری‌شده به انتهای همان فایل اضافه می‌کنیم:
 *
 *     /*rtl-universal-start* ... موتور + تنظیمات ... /*rtl-universal-end* 
 *
 * مزایا: با هر Reload کار می‌کند و به هیچ API داخلی وابسته نیست.
 * هزینه: بعد از آپدیت IDE فایل بازنویسی می‌شود → افزونه خودش دوباره پچ می‌کند.
 *
 * نکته: ویرایش این فایل ممکن است یک‌بار پیام «installation appears to be
 * corrupt» بدهد؛ این پیام فقط هشدار است و با «Don't show again» رد می‌شود.
 * ========================================================================== */
const ENGINE_PATH = path.join(__dirname, 'media', 'rtl-engine.js');

const BEGIN = '/*rtl-universal-start*/';
const END = '/*rtl-universal-end*/';
const BAK_SUFFIX = '.rtl-universal.bak';

let statusBarItem = null;
let lastPatchError = null;

/* ------------------------------------------------------------------ *
 * Workbench discovery
 * ------------------------------------------------------------------ */
/* مسیرهای ممکن فایل Workbench در فورک‌های مختلف VS Code کمی متفاوت است؛
 * هر سه را امتحان می‌کنیم و اولین موجود را برمی‌داریم. */
function workbenchCandidates() {
  const appRoot = vscode.env.appRoot;
  const list = [
    path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js'),
    path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.main.js'),
    path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.js')
  ];
  return list;
}

function findWorkbenchFile() {
  for (const p of workbenchCandidates()) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch (e) { /* next */ }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Patch block
 * ------------------------------------------------------------------ */
function readEngine() {
  return fs.readFileSync(ENGINE_PATH, 'utf8');
}

/* تنظیمات کاربر را از Settings می‌خواند و به شکل شیء تنظیمات موتور درمی‌آورد.
 * این تنظیمات «داخل» بلوک پچ نوشته می‌شوند، پس بعد از Reload اعمال می‌شوند. */
function readConfig() {
  const config = vscode.workspace.getConfiguration('rtlUniversal');
  const cfg = {
    mode: config.get('mode', 'smart'),
    inputs: config.get('inputs', true),
    monacoChatInput: config.get('monacoChatInput', true),
    extraCSS: config.get('extraCSS', '') || '',
    containerSelector: buildContainerSelector(config)
  };
  const exclude = String(config.get('excludeSelector', '') || '').trim();
  if (exclude) cfg.excludeSelector = exclude;
  return cfg;
}

function buildContainerSelector(config) {
  const base = [
    '.markdown',
    '.prose',
    '.rendered-markdown',
    '.chat-markdown-part',
    '.ds-markdown',
    '.font-claude-message',
    'message-content',
    '.assistant-message',
    '.interactive-session .value .rendered-markdown',
    '.chat-widget .rendered-markdown',
    '.welcome-view-content',
    '[data-testid="chat-message"] .markdown',
    '.anysphere-markdown-container',
    '.composer-rendered-message'
  ];
  const extra = String(config.get('containerSelector', '') || '').trim();
  if (extra) base.push(extra);
  return base.join(',');
}

/* متن بلوکی که به Workbench اضافه می‌شود.
 * شروع و پایان با کامنت‌های ویژه علامت‌گذاری شده‌اند تا بعداً بتوانیم
 * دقیقاً همان بلوک را پیدا و حذف/جایگزین کنیم (بدون دست‌زدن به کد IDE). */
function buildBlock() {
  const cfgJson = JSON.stringify(readConfig());
  const engine = readEngine();
  return (
    '\n' + BEGIN + '\n' +
    ';(function () {\n' +
    '  try {\n' +
    '    window.__RTL_UNIVERSAL_CONFIG__ = ' + cfgJson + ';\n' +
    '  } catch (e) {}\n' +
    engine + '\n' +
    '})();\n' +
    END + '\n'
  );
}

function hasBlock(content) {
  return content.indexOf(BEGIN) !== -1;
}

/* معکوس buildBlock: بلوک ما را پیدا و حذف می‌کند.
 * اگر بلوک نیمه‌تمام باشد (فقط start بدون end)، از start تا انتها بریده می‌شود
 * تا فایل هیچ‌وقت خراب نماند. */
function stripBlock(content) {
  const b = content.indexOf(BEGIN);
  if (b === -1) return content;
  const e = content.indexOf(END, b);
  if (e === -1) return content.slice(0, b); // malformed: cut to the end
  return content.slice(0, b) + content.slice(e + END.length);
}

/* «نوشتن اتمیک»: اول در فایل موقت می‌نویسیم بعد rename می‌کنیم.
 * اگر وسط نوشتن برق برود یا برنامه بسته شود، فایل اصلی نیمه‌کاره نمی‌ماند.
 *
 * در ویندوز rename روی فایلِ در حال استفاده خطا می‌دهد؛ آنجا به کپی
 * برمی‌گردیم (ساده‌ترین راه سازگار با همه‌ی سیستم‌عامل‌ها). */
function atomicWrite(file, content) {
  const tmp = file + '.rtl-tmp-' + process.pid;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    const st = fs.statSync(file);
    fs.chmodSync(tmp, st.mode);
  } catch (e) { /* ignore */ }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // Windows: rename over existing fails if locked; fall back to copy.
    fs.copyFileSync(tmp, file);
    try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ }
  }
}

/* ------------------------------------------------------------------ *
 * Patch lifecycle
 * ------------------------------------------------------------------ */
/* ============================================================================
 * applyPatch — اعمال پچ
 * ----------------------------------------------------------------------------
 * ۱. فایل Workbench را پیدا کن
 * ۲. اگر بلوک قبلی هست → محتوایش را با تنظیمات تازه جایگزین کن (بدون تکرار)
 * ۳. اگر نه → یک بکاپ بگیر و بلوک را اضافه کن
 *
 * پارامتر silent: اگر false باشد، خطاها به کاربر هم نشان داده می‌شوند.
 * ========================================================================== */
async function applyPatch(silent) {
  const file = findWorkbenchFile();
  if (!file) {
    lastPatchError = 'فایل Workbench پیدا نشد. این IDE با معماری VS Code Workbench سازگار نیست.';
    updateStatus('error');
    if (!silent) vscode.window.showErrorMessage('CyrusAsha_UniversalRTL-1.0.0: ' + lastPatchError);
    return false;
  }
  try {
    const content = fs.readFileSync(file, 'utf8');
    if (hasBlock(content)) {
      // Replace old block with current config/engine (idempotent).
      const updated = stripBlock(content).replace(/\s+$/, '\n') + buildBlock();
      if (updated !== content) atomicWrite(file, updated);
    } else {
      // Side-by-side backup, refreshed per IDE version.
      const bak = file + BAK_SUFFIX;
      const pkg = readProductVersion();
      const bakInfo = bak + '.json';
      let currentInfo = null;
      try { currentInfo = fs.readFileSync(bakInfo, 'utf8'); } catch (e) { /* none */ }
      if (!fs.existsSync(bak) || currentInfo !== pkg) {
        fs.copyFileSync(file, bak);
        try { fs.writeFileSync(bakInfo, pkg, 'utf8'); } catch (e) { /* ignore */ }
      }
      atomicWrite(file, content.replace(/\s+$/, '\n') + buildBlock());
    }
    lastPatchError = null;
    updateStatus();
    return true;
  } catch (e) {
    lastPatchError = 'نوشتن روی فایل Workbench ممکن نشد (' + e.code + '). ' +
      'IDE را به‌صورت per-user نصب کن یا دسترسی نوشتن به پوشه نصب بده.';
    updateStatus('error');
    if (!silent) {
      const choice = await vscode.window.showErrorMessage('CyrusAsha_UniversalRTL-1.0.0: ' + lastPatchError,
        'راهنمای دسترسی');
      if (choice) {
        vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs/editor/portable'));
      }
    }
    return false;
  }
}

/* نام و نسخه‌ی IDE را می‌خواند تا بکاپ مربوط به همان نسخه باشد.
 * بعد از آپدیت IDE، بکاپ قدیمی بی‌ارزش می‌شود و باید بازسازی شود. */
function readProductVersion() {
  try {
    const p = path.join(vscode.env.appRoot, 'product.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return JSON.stringify({ n: j.nameShort || j.name || '', v: j.version || vscode.version });
  } catch (e) {
    return JSON.stringify({ v: vscode.version });
  }
}

/* حذف پچ:
 *   اگر بکاپ باشد → آن را برمی‌گردانیم (دقیقاً نسخه‌ی اصلی)
 *   وگرنه → بلوک را «جراحی» حذف می‌کنیم
 * سپس به کاربر پیشنهاد Reload می‌دهیم. */
async function removePatch(silent) {
  const file = findWorkbenchFile();
  if (!file) return false;
  try {
    const bak = file + BAK_SUFFIX;
    if (fs.existsSync(bak)) {
      fs.copyFileSync(bak, file);
      try { fs.unlinkSync(bak); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(bak + '.json'); } catch (e) { /* ignore */ }
    } else {
      const content = fs.readFileSync(file, 'utf8');
      if (hasBlock(content)) atomicWrite(file, stripBlock(content).replace(/\s+$/, '\n'));
    }
    updateStatus('off');
    if (!silent) {
      const reload = await vscode.window.showInformationMessage(
        'CyrusAsha_UniversalRTL-1.0.0 حذف شد. برای اعمال، پنجره را Reload کن.', 'Reload');
      if (reload) vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
    return true;
  } catch (e) {
    if (!silent) vscode.window.showErrorMessage('CyrusAsha_UniversalRTL-1.0.0: حذف پچ ممکن نشد — ' + e.message);
    return false;
  }
}

function needsReloadAfterChange() {
  vscode.window.showInformationMessage(
    'CyrusAsha_UniversalRTL-1.0.0: تنظیمات ذخیره شد. برای اعمال کامل، پنجره را Reload کن.',
    'Reload'
  ).then((c) => { if (c) vscode.commands.executeCommand('workbench.action.reloadWindow'); });
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ */
/* آیکون و متن نوار وضعیت (پایین-راست IDE).
 * با کلیک روی آن، افزونه روشن/خاموش می‌شود. */
function updateStatus(forced) {
  if (!statusBarItem) return;
  const config = vscode.workspace.getConfiguration('rtlUniversal');
  const enabled = config.get('enabled', true);
  const mode = config.get('mode', 'smart');
  if (forced === 'error' || lastPatchError) {
    statusBarItem.text = '$(warning) RTL';
    statusBarItem.tooltip = 'CyrusAsha_UniversalRTL-1.0.0 — خطا: ' + (lastPatchError || '');
  } else if (!enabled) {
    statusBarItem.text = '$(circle-slash) RTL';
    statusBarItem.tooltip = 'CyrusAsha_UniversalRTL-1.0.0 غیرفعال — کلیک برای فعال‌سازی';
  } else if (mode === 'rtl') {
    statusBarItem.text = '$(arrow-right) RTL اجباری';
    statusBarItem.tooltip = 'همه‌ی پیام‌ها راست‌چین';
  } else if (mode === 'ltr') {
    statusBarItem.text = '$(arrow-left) LTR اجباری';
    statusBarItem.tooltip = 'همه‌ی پیام‌ها چپ‌چین';
  } else {
    statusBarItem.text = '$(text-direction-rtl) RTL هوشمند';
    statusBarItem.tooltip = 'تشخیص خودکار فارسی/عربی/عبری — کدها و ترمینال LTR می‌مانند';
  }
  statusBarItem.command = 'rtlUniversal.toggle';
  statusBarItem.show();
}

/* ------------------------------------------------------------------ *
 * Activation
 * ------------------------------------------------------------------ */
/* ============================================================================
 * activate — زمانی که IDE افزونه را بارگذاری می‌کند اجرا می‌شود
 * ----------------------------------------------------------------------------
 * کارها:
 *   - ساخت آیتم نوار وضعیت
 *   - ثبت دستورها (روشن/خاموش، حالت‌ها، اسکن مجدد، بازگردانی)
 *   - گوش دادن به تغییر تنظیمات
 *   - پچ خودکار در شروع + «خودترمیمی» هر ۵ دقیقه بعد از آپدیت IDE
 * ========================================================================== */
function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  context.subscriptions.push(statusBarItem);

  const config = vscode.workspace.getConfiguration('rtlUniversal');

  const ensure = async (silent) => {
    if (config.get('enabled', true)) await applyPatch(silent);
    else updateStatus('off');
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('rtlUniversal.enable', async () => {
      await vscode.workspace.getConfiguration('rtlUniversal').update('enabled', true, true);
      if (await applyPatch(false)) needsReloadAfterChange();
      updateStatus();
    }),
    vscode.commands.registerCommand('rtlUniversal.disable', async () => {
      await vscode.workspace.getConfiguration('rtlUniversal').update('enabled', false, true);
      await removePatch(false);
    }),
    vscode.commands.registerCommand('rtlUniversal.toggle', async () => {
      const enabled = vscode.workspace.getConfiguration('rtlUniversal').get('enabled', true);
      if (enabled) {
        await vscode.workspace.getConfiguration('rtlUniversal').update('enabled', false, true);
        await removePatch(false);
      } else {
        await vscode.workspace.getConfiguration('rtlUniversal').update('enabled', true, true);
        if (await applyPatch(false)) needsReloadAfterChange();
      }
      updateStatus();
    }),
    vscode.commands.registerCommand('rtlUniversal.setModeSmart', () => setMode('smart')),
    vscode.commands.registerCommand('rtlUniversal.setModeRtl', () => setMode('rtl')),
    vscode.commands.registerCommand('rtlUniversal.setModeLtr', () => setMode('ltr')),
    vscode.commands.registerCommand('rtlUniversal.rescan', async () => {
      // Re-apply so that a fresh engine/config lands in the workbench file,
      // then reload the window to take effect.
      if (await applyPatch(false)) needsReloadAfterChange();
      updateStatus();
    }),
    vscode.commands.registerCommand('rtlUniversal.restoreWorkbench', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'فایل Workbench به نسخه اصلی برگردانده شود؟ (افزونه غیرفعال می‌شود)', 'بله', 'لغو');
      if (confirm === 'بله') {
        await vscode.workspace.getConfiguration('rtlUniversal').update('enabled', false, true);
        await removePatch(false);
      }
    })
  );

  async function setMode(mode) {
    await vscode.workspace.getConfiguration('rtlUniversal').update('mode', mode, true);
    await vscode.workspace.getConfiguration('rtlUniversal').update('enabled', true, true);
    if (await applyPatch(false)) needsReloadAfterChange();
    updateStatus();
  }

  // Config changed → rewrite patch block (silent; no reload spam).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration('rtlUniversal')) return;
      if (vscode.workspace.getConfiguration('rtlUniversal').get('enabled', true)) {
        await applyPatch(true);
      }
      updateStatus();
    })
  );

  // Self-heal: after an IDE update the bundle is replaced and the block disappears.
  // Re-apply on activation and whenever the workbench file looks pristine again.
  ensure(false).then(() => {
    const timer = setInterval(async () => {
      const file = findWorkbenchFile();
      if (!file) return;
      try {
        const content = fs.readFileSync(file, 'utf8');
        if (!hasBlock(content) && vscode.workspace.getConfiguration('rtlUniversal').get('enabled', true)) {
          await applyPatch(true);
        }
      } catch (e) { /* ignore */ }
    }, 5 * 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref(); // Node test hosts
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
  });

  // First-run hint about the one-time "installation is corrupt" prompt.
  if (!context.globalState.get('rtlUniversal.notified', false)) {
    const cfg = vscode.workspace.getConfiguration('rtlUniversal');
    if (cfg.get('enabled', true) && hasBlockSafe()) {
      vscode.window.showInformationMessage(
        'CyrusAsha_UniversalRTL-1.0.0 فعال شد ✅ اگر بعد از Reload پیام «installation appears to be corrupt» دیدی، ' +
        'روی «Don\'t show again» بزن؛ این پیام طبیعی است و اثری روی IDE ندارد.',
      ).then(() => context.globalState.update('rtlUniversal.notified', true));
    }
  }
}

function hasBlockSafe() {
  try {
    const file = findWorkbenchFile();
    if (!file) return false;
    return hasBlock(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return false;
  }
}

/* وقتی IDE افزونه را غیرفعال می‌کند؛ فقط آیتم نوار وضعیت را پاک می‌کنیم.
 * (پچ فایل Workbench را عمداً دست نمی‌زنیم تا کاربر خودش تصمیم بگیرد.) */
function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
}

module.exports = { activate, deactivate };
