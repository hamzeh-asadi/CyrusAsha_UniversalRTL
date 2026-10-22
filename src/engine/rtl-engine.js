/*!
 * CyrusAsha_UniversalRTL-1.0.0 — موتور راست‌چین هوشمند برای محیط‌های Agent
 * https://github.com/rtl-universal
 *
 * Works everywhere: VS Code-family workbench, standalone Electron apps, web AI chats.
 * - Detects direction per message/block from its own content (Persian / Arabic / Hebrew).
 * - Keeps code, terminals, math and inline code LTR (isolated).
 * - Reacts to streaming / dynamic DOM (MutationObserver, Shadow DOM aware).
 * - Zero dependencies. Safe to inject multiple times (single instance guard).
 *
 * License: MIT
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* ------------------------------------------------------------------ *
   * 1. Configuration
   * ------------------------------------------------------------------ */
  /* ==========================================================================
 * ۱) تنظیمات پیش‌فرض
 * --------------------------------------------------------------------------
 * این شیء تمام «پیچ‌های تنظیم» موتور است. هر کلید یعنی چه؟
 *
 *   enabled         → موتور روشن/خاموش باشد.
 *   mode            → 'smart' تشخیص خودکار | 'rtl' همه راست‌چین | 'ltr' همه چپ‌چین
 *   inputs          → برای کادرهای متن (input/textarea) خودکار dir="auto" بگذاریم؟
 *   monacoChatInput → کادر چت Monaco (مثل چت VS Code) را هم تشخیص دهیم؟
 *   shadows         → داخل Shadow DOM (کامپوننت‌های وب) هم برویم؟
 *   containerSelector → سلکتورهایی که «ظرف پیام» هستند (کلاس‌های رایج چت‌ها)
 *   excludeSelector → نواحی‌ای که هرگز دست نزنیم
 *   extraCSS        → CSS سفارشی کاربر (مثلاً فونت وزیرمتن)
 *   maxTextScan     → حداکثر تعداد کاراکتری که از هر بلوک می‌خوانیم (سرعت)
 * ========================================================================== */
  var DEFAULT_CONFIG = {
    enabled: true,
    mode: 'smart',            // 'smart' | 'rtl' | 'ltr'
    inputs: true,             // auto-direction for text inputs / textareas
    monacoChatInput: true,    // best-effort RTL for Monaco chat composers (VS Code family)
    shadows: true,            // pierce open shadow roots
    containerSelector: [
      '.markdown',
      '.prose',
      '.rendered-markdown',
      '.chat-markdown-part',
      '.ds-markdown',
      '.font-claude-message',
      'message-content',
      '.assistant-message',
      '.message-content',
      '.msg-content'
    ].join(','),
    excludeSelector: '',      // extra CSS selectors to skip (comma separated)
    extraCSS: '',             // custom CSS appended to the injected stylesheet
    maxTextScan: 1600         // characters gathered per element
  };

  var CFG = Object.assign({}, DEFAULT_CONFIG);
  var injectedCfg = (typeof global !== 'undefined' && global.__RTL_UNIVERSAL_CONFIG__) || null;
  if (injectedCfg && typeof injectedCfg === 'object') Object.assign(CFG, injectedCfg);

  var IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (!IS_BROWSER) {
    // Node.js (tests / CLI helpers) — export pure functions only.
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        version: VERSION,
        decideDirection: decideDirection,
        strongKind: strongKind
      };
    }
    return;
  }

  /* --------------------------------------------------------------------
   * محافظ «یک‌بار اجرا»: اگر موتور قبلاً در همین صفحه اجرا شده باشد،
   * دوباره اجرا نمی‌شود؛ وگرنه دو MutationObserver و دو استایل تکراری
   * ساخته می‌شد و صفحه کند می‌شد.
   * -------------------------------------------------------------------- */
  if (global.__RTL_UNIVERSAL_LOADED__) return;
  global.__RTL_UNIVERSAL_LOADED__ = true;

  /* ------------------------------------------------------------------ *
   * 2. Unicode direction detection
   * ------------------------------------------------------------------ */
  /* ==========================================================================
   * ۲) تشخیص جهت از روی متن (بدون هیچ کتابخانه‌ای)
   * --------------------------------------------------------------------------
   * هر حرف در یونیکد یک «جهت ذاتی» دارد:
   *   - حروف فارسی/عربی/عبری → راست‌به‌چپ (RTL)
   *   - حروف لاتین           → چپ‌به‌راست (LTR)
   *   - عدد، فاصله، ایموجو، نقطه‌گذاری → «خنثی» (جهت خودشان را ندارند)
   *
   * این بخش با یک RegExp محدوده‌های یونیکدی RTL را تشخیص می‌دهد.
   * ========================================================================== */
  var RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{1EE00}-\u{1EEFF}]/u;
  var LETTER_RE = /\p{L}/u;

  /* یک کاراکتر را می‌گیرد و می‌گوید 'rtl' است، 'ltr' است یا null (خنثی).
   * نکته: codePointAt برای کاراکترهای خارج از صفحه‌ی BMP (ایموجی، خط میخی و…)
   * عددی بزرگ‌تر از 0xFFFF برمی‌گرداند؛ String.fromCodePoint آن را درست می‌سازد. */
  function strongKind(codePoint) {
    var ch = String.fromCodePoint(codePoint);
    if (RTL_RE.test(ch)) return 'rtl';
    if (LETTER_RE.test(ch)) return 'ltr';
    return null; // digits, punctuation, emoji, whitespace → neutral
  }

  /**
   * Smart direction decision.
   * Counts strong letters in the first ~120 strong characters; majority wins,
   * near-ties fall back to the first strong character (Unicode bidi behavior).
   * Returns 'rtl' | 'ltr' | null (neutral content → leave untouched).
   */
  /* «مغز» موتور: جهت یک متن را تعیین می‌کند.
   *
   * روش کار:
   *   ۱. فقط ۱۲۰ حرف «قوی» اول متن را می‌شماریم (برای سرعت و دقت).
   *   ۲. اگر همه RTL بودند → rtl، اگر همه LTR بودند → ltr.
   *   ۳. اگر مخلوط بودند: اگر ≥۵۵٪ حروف RTL باشند → rtl، اگر ≥۵۵٪ LTR → ltr.
   *   ۴. اگر نزدیک به مساوی بود (۵۵٪ تا ۴۵٪) → همان قاعده‌ی استاندارد یونیکد:
   *      «اولین حرف قوی» تعیین می‌کند (first strong character).
   *   ۵. اگر هیچ حرفی نبود (فقط عدد/ایموجی) → null یعنی دست نزن.
   *
   * چرا ۵۵٪؟ چون جمله‌های فارسی معمولاً چند کلمه‌ی انگلیسی دارند
   * (React، API، hook…) و نباید باعث شوند جمله اشتباهی چپ‌چین شود. */
  function decideDirection(text) {
    if (!text) return null;
    var rtl = 0, ltr = 0, firstStrong = null, seen = 0;
    for (var i = 0; i < text.length && seen < 120; i++) {
      var code = text.codePointAt(i);
      if (code > 0xffff) i++; // skip low surrogate
      var kind = strongKind(code);
      if (!kind) continue;
      if (!firstStrong) firstStrong = kind;
      if (kind === 'rtl') rtl++; else ltr++;
      seen++;
    }
    if (!rtl && !ltr) return null;
    if (!ltr) return 'rtl';
    if (!rtl) return 'ltr';
    var ratio = rtl / (rtl + ltr);
    if (ratio >= 0.55) return 'rtl';
    if (ratio <= 0.45) return 'ltr';
    return firstStrong;
  }

  /* ------------------------------------------------------------------ *
   * 3. DOM helpers
   * ------------------------------------------------------------------ */
  /* ==========================================================================
   * ۳) ابزارهای کار با DOM (درخت صفحه)
   * --------------------------------------------------------------------------
   * DOM همان درخت تگ‌های صفحه است: html > body > div > p > span …
   *
   * SKIP_TAGS: تگ‌هایی که «هرگز» نباید جهت‌شان عوض شود (کد، ترمینال، ورودی…).
   * BLOCK_TAGS: تگ‌های بلوکی (پاراگراف، آیتم لیست، سرتیتر…) که ظرف متن هستند.
   * INLINE_TAGS: تگ‌های درون‌خطی (bold، لینک، کد کوتاه…) که در جریان متن‌اند.
   * ========================================================================== */
  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, PRE: 1, CODE: 1, KBD: 1, SAMP: 1,
    TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, BUTTON: 1, SVG: 1,
    CANVAS: 1, IFRAME: 1, VIDEO: 1, AUDIO: 1, TEMPLATE: 1, MATH: 1
  };

  var BLOCK_TAGS = {
    P: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, BLOCKQUOTE: 1,
    TD: 1, TH: 1, DT: 1, DD: 1, FIGCAPTION: 1, SUMMARY: 1, CAPTION: 1
  };

  var INLINE_TAGS = {
    SPAN: 1, A: 1, STRONG: 1, EM: 1, B: 1, I: 1, U: 1, S: 1, CODE: 1,
    KBD: 1, SAMP: 1, BR: 1, IMG: 1, SVG: 1, SMALL: 1, MARK: 1, SUB: 1,
    SUP: 1, ABBR: 1, TIME: 1, DEL: 1, INS: 1, WBR: 1, BUTTON: 1
  };

  // Subtrees whose text must never influence direction and never be re-directed.
  /* نواحی‌ای که «نه» جهتشان عوض می‌شود و «نه» متنشان در تشخیص جهت شمرده می‌شود.
   * مهم‌ترین بخش برای سالم‌ماندن کد: pre/code/ترمینال/Monaco/KaTeX */
  var EXCLUDE_SELECTOR = [
    'pre', 'code', 'kbd', 'samp', 'textarea', 'select',
    '.monaco-editor', '.xterm',
    '[class*="terminal" i]',
    '[class*="katex"]', 'mjx-container',
    '[data-rtl-skip]', '.rtl-universal-ignore'
  ].join(',');

  var TERMINAL_CLASS_RE = /(^|[\s_-])(xterm|terminal|shell|console|repl)([\s_-]|$)/i;

  // Message-level containers that should receive `dir` as a whole (better typography).
  var TIER1_TOKEN_RE = /(^|[\s_-])(markdown|prose|rendered-markdown|chat-markdown-part|md-content|message-content|msg-content|bubble-content|response-content|answer-content|chat-message-content|font-claude-message|ds-markdown)([\s_-]|$)/i;

  /* کلاس و id یک المان را به‌صورت یک رشته‌ی واحد برمی‌گرداند تا با یک RegExp
   * بتوانیم نام‌های رایج را تشخیص دهیم (مثلاً "monaco-editor" یا "xterm"). */
  function classString(el) {
    return (el.getAttribute && (el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '')) || '';
  }

  /* آیا این المان و «تمام فرزندانش» باید نادیده گرفته شوند؟
   * True یعنی: کد/ترمینال است یا data-rtl-skip دارد یا با excludeSelector جور است. */
  function shouldSkipSubtree(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS[el.tagName]) return true;
    if (el.hasAttribute && el.hasAttribute('data-rtl-skip')) return true;
    if (TERMINAL_CLASS_RE.test(classString(el))) return true;
    try {
      if (EXCLUDE_SELECTOR && el.matches(EXCLUDE_SELECTOR)) return true;
    } catch (e) { /* invalid selector in old engines */ }
    return false;
  }

  /* Monaco ادیتور کد است، اما بعضی IDEها (مثل VS Code/Antigravity) همان را
   * به‌عنوان «کادر ورودی چت» هم استفاده می‌کنند. این تابع بررسی می‌کند
   * آیا این Monaco داخل یک ناحیه‌ی چت است یا داخل پنل ترمینال/ادیتور عادی.
   * اگر ترمینال باشد false برمی‌گردد تا هرگز دست نزنیم. */
  function isChatMonaco(root) {
    var node = root;
    for (var depth = 0; node && depth < 10; depth++) {
      if (TERMINAL_CLASS_RE.test(classString(node))) return false;
      if (/(interactive-input|chat[-_]?editor|chat[-_]?input|composer|interactive-session|copilot[-_]?chat|agent[-_]?input|prompt[-_]?input)/i.test(classString(node))) return true;
      node = node.parentElement;
    }
    return false;
  }

  /**
   * Gather visible text of a subtree, ignoring code/terminal subtrees.
   * Uses TreeWalker with FILTER_REJECT to prune excluded subtrees efficiently.
   */
  /* متن قابل‌مشاهده‌ی یک زیردرخت را جمع می‌کند، اما:
   *   - داخل کد/ترمینال نمی‌رود (چون نباید در تشخیص جهت اثر بگذارد)
   *   - با TreeWalker کار می‌کند؛ این API استاندارد مرورگر برای پیمایش سریع
   *     گره‌های متنی است و با FILTER_REJECT کل شاخه‌های ممنوع را می‌پراند
   *     (بسیار سریع‌تر از حلقه روی همه‌ی فرزندان).
   *   - حداکثر maxLen کاراکتر می‌خواند تا روی چت‌های خیلی طولانی کند نشود. */
  function gatherText(root, maxLen) {
    maxLen = maxLen || CFG.maxTextScan;
    var out = '';
    var walker;
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (node.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
          if (shouldSkipSubtree(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }, false);
    } catch (e) {
      return root.textContent || '';
    }
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeType !== 3) continue;
      var data = node.nodeValue;
      if (!data) continue;
      out += data;
      if (out.length >= maxLen) break;
    }
    return out;
  }

  function directionFor(el) {
    var text = gatherText(el);
    return decideDirection(text);
  }

  /* ------------------------------------------------------------------ *
   * 4. Styles
   * ------------------------------------------------------------------ */
  var STYLE_ID = 'rtl-universal-style';
  var styleNode = null;

  /* ==========================================================================
   * ۴) CSS تزریقی
   * --------------------------------------------------------------------------
   * چرا فقط با dir کار نمی‌کنیم و CSS هم لازم است؟
   *   - dir="rtl" جهت و چیدمان را عوض می‌کند؛
   *   - اما یک <pre> داخل متن RTL باید «صریحاً» LTR و ایزوله بماند، وگرنه
   *     علامت‌های کد (پرانتز، عملگر، آدرس) جابه‌جا و کد ناخوانا می‌شود.
   *   - unicode-bidi:isolate یعنی «این بلوک مستقل از متن اطرافش جهت‌دهی شود».
   * ========================================================================== */
  function styleCSS() {
    return [
      '/* rtl-universal */',
      '[data-rtl-dir="rtl"] { direction: rtl !important; text-align: start !important; }',
      '[data-rtl-dir="ltr"] { direction: ltr !important; text-align: start !important; }',
      /* Code / terminal / math are always LTR and isolated, wherever they appear in RTL text. */
      '[data-rtl-dir="rtl"] :is(pre, code, kbd, samp, .monaco-editor, .xterm, [class*="terminal" i], [class*="katex"], mjx-container) {',
      '  direction: ltr !important; text-align: left !important; unicode-bidi: isolate;',
      '}',
      /* Lists keep their markers on the correct side automatically (dir attribute), nothing to do. */
      /* Monaco chat input — best effort while typing Persian inside the composer. */
      '.rtl-universal-input-rtl .view-lines { direction: rtl !important; }',
      '.rtl-universal-input-rtl .view-line { text-align: right !important; }',
      '.rtl-universal-input-rtl .current-line { border-left: none; }',
      CFG.extraCSS ? '/* user css */\n' + CFG.extraCSS : ''
    ].join('\n');
  }

  /* یک تگ <style> به صفحه (یا به داخل یک Shadow Root) اضافه می‌کند.
   * id ثابت دارد تا هر بار نسخه‌ی تکراری ساخته نشود. */
  function ensureStyles(root) {
    if (!root || !root.querySelector) return;
    var existing = root.querySelector('#' + STYLE_ID);
    if (existing) { styleNode = existing; return existing; }
    if (!styleNode) {
      styleNode = document.createElement('style');
      styleNode.id = STYLE_ID;
      styleNode.textContent = styleCSS();
    }
    var target = root === document ? (document.head || document.documentElement) : root;
    if (!target) return null;
    var clone = styleNode.cloneNode(true);
    target.appendChild(clone);
    if (root === document) styleNode = clone;
    return clone;
  }

  /* ------------------------------------------------------------------ *
   * 5. Applying / removing direction
   * ------------------------------------------------------------------ */
  var stats = { processed: 0, rtl: 0, ltr: 0, skipped: 0 };

  /* ==========================================================================
   * ۵) اعمال و بازگردانی جهت
   * --------------------------------------------------------------------------
   * وقتی جهت را عوض می‌کنیم، مقدار قبلی dir را در data-rtl-orig-dir نگه می‌داریم
   * تا در disable() بتوانیم دقیقاً همه‌چیز را به حالت اول برگردانیم.
   * ========================================================================== */
  function applyDirection(el, dir) {
    if (!dir) return false;
    // Respect author-provided direction attributes (only override our own).
    if (el.hasAttribute('dir') && !el.hasAttribute('data-rtl-dir')) return false;
    if (el.getAttribute('data-rtl-dir') === dir) return false;
    if (!el.hasAttribute('data-rtl-dir')) {
      el.setAttribute('data-rtl-orig-dir', el.getAttribute('dir') || '');
    }
    el.setAttribute('data-rtl-dir', dir);
    el.setAttribute('dir', dir);
    stats[dir] = (stats[dir] || 0) + 1;
    return true;
  }

  function restoreElement(el) {
    if (!el.hasAttribute('data-rtl-dir')) return;
    var orig = el.getAttribute('data-rtl-orig-dir');
    el.removeAttribute('data-rtl-dir');
    el.removeAttribute('data-rtl-orig-dir');
    if (orig) el.setAttribute('dir', orig);
    else el.removeAttribute('dir');
  }

  function restoreAttribute(el, attr) {
    if (el.getAttribute('data-rtl-auto') === attr) {
      el.removeAttribute(attr);
      el.removeAttribute('data-rtl-auto');
    }
  }

  /* خاموش‌کردن موتور: همه‌ی dirها و کلاس‌های تزریقی به حالت اولیه برمی‌گردند
   * و آمار صفر می‌شود. این همان کاری است که دکمه‌ی «غیرفعال» انجام می‌دهد. */
  function restoreAll() {
    var marked = document.querySelectorAll('[data-rtl-dir]');
    for (var i = 0; i < marked.length; i++) restoreElement(marked[i]);
    var autos = document.querySelectorAll('[data-rtl-auto]');
    for (var j = 0; j < autos.length; j++) restoreAttribute(autos[j], autos[j].getAttribute('data-rtl-auto'));
    var inputs = document.querySelectorAll('.rtl-universal-input-rtl');
    for (var k = 0; k < inputs.length; k++) inputs[k].classList.remove('rtl-universal-input-rtl');
    stats.processed = stats.rtl = stats.ltr = stats.skipped = 0;
  }

  /* ------------------------------------------------------------------ *
   * 6. Candidate classification & processing
   * ------------------------------------------------------------------ */
  /* ==========================================================================
   * ۶) طبقه‌بندی المان‌ها: کدام‌ها ظرف پیام‌اند؟
   * --------------------------------------------------------------------------
   * Tier 1: ظرف کل پیام (کلاس‌هایی مثل markdown/prose/message-content)
   * Tier 2: بلوک‌های داخل پیام (p، li، h1…، یا divهایی که فقط متن دارند)
   * اگر Tier 1 را درست تشخیص دهیم، جهت‌دهی یک‌جا انجام می‌شود و نتیجه
   * زیباتر است (لیست‌ها، نقل‌قول‌ها و فاصله‌ها هم درست می‌شوند).
   * ========================================================================== */
  function isTier1Container(el) {
    try {
      if (CFG.containerSelector && el.matches && el.matches(CFG.containerSelector)) return true;
    } catch (e) { /* ignore */ }
    return TIER1_TOKEN_RE.test(classString(el));
  }

  /* آیا این المان یک «برگ» متنی است؟ یعنی فرزندانش فقط تگ‌های درون‌خطی‌اند
   * (مثل <p>سلام <b>دنیا</b></p>) و خودش متن قابل‌توجه دارد.
   * این‌ها بهترین واحد برای جهت‌دهی‌اند. */
  function isLeafBlock(el) {
    var children = el.children;
    if (!children || children.length === 0) {
      return !!(el.textContent && /\S/.test(el.textContent));
    }
    if (children.length > 12) return false;
    for (var i = 0; i < children.length; i++) {
      if (!INLINE_TAGS[children[i].tagName]) return false;
    }
    return !!(el.textContent && /\S/.test(el.textContent));
  }

  function isEditableRoot(el) {
    if (!el.isContentEditable) return false;
    var closest = el.closest ? el.closest('[contenteditable]') : null;
    return closest === el;
  }

  /* کادرهای ورودی: به‌جای دست‌کاری دستی، از dir="auto" خود مرورگر استفاده می‌کنیم؛
   * مرورگر وقتی فارسی تایپ کنی مکان‌نما را خودکار راست می‌کند.
   * فقط inputهای متنی (نه checkbox/date/file…) شامل می‌شوند. */
  function handleInputElement(el) {
    if (!CFG.inputs) return;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (/^(checkbox|radio|range|color|file|button|submit|reset|image|hidden|date|datetime-local|month|week|time)$/.test(type)) return;
      if (!el.hasAttribute('dir')) {
        el.setAttribute('dir', 'auto');
        el.setAttribute('data-rtl-auto', 'dir');
      }
    }
  }

  var monacoSig = new WeakMap();

  /* برای کادر چت Monaco: متن داخل .view-lines را می‌خوانیم و اگر فارسی بود
   * کلاس rtl-universal-input-rtl را اضافه/حذف می‌کنیم (CSS آن را راست‌چین می‌کند). */
  function updateMonacoChatInput(monaco) {
    if (!CFG.monacoChatInput || !monaco || !isChatMonaco(monaco)) return;
    var lines = monaco.querySelector('.view-lines');
    if (!lines) return;
    var text = lines.textContent || '';
    var sig = text.length + '|' + text.slice(-24);
    if (monacoSig.get(monaco) === sig) return;
    monacoSig.set(monaco, sig);
    var dir = CFG.mode === 'rtl' ? 'rtl' : CFG.mode === 'ltr' ? 'ltr' : decideDirection(text);
    if (dir === 'rtl') monaco.classList.add('rtl-universal-input-rtl');
    else if (dir === 'ltr') monaco.classList.remove('rtl-universal-input-rtl');
  }

  var sigCache = new WeakMap();

  /* ==========================================================================
   * ۷) پردازش یک المان (قلب عملیات)
   * --------------------------------------------------------------------------
   * ترتیب کارها مهم است:
   *   ۱. ورودی‌ها → dir=auto
   *   ۲. Monaco چت → بررسی جدا (چون خودش در لیست استثناهاست)
   *   ۳. استثناها → رد
   *   ۴. Tier1/Tier2 → تشخیص جهت و اعمال
   * ========================================================================== */
  function processElement(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return;
    stats.processed++;

    // Inputs → browser-native auto direction (typing Persian flips the caret side).
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      handleInputElement(el);
      return;
    }
    // Monaco (IDE) chat composer special case — must run before the exclusion check,
    // because .monaco-editor itself is an excluded subtree.
    if (el.classList && el.classList.contains('monaco-editor')) {
      updateMonacoChatInput(el);
      return;
    }
    // Never touch excluded subtrees.
    if (shouldSkipSubtree(el)) { stats.skipped++; return; }
    // Rich text editor hosts: leave the root alone (inner paragraphs are handled).
    if (isEditableRoot(el)) return;

    var dir = null;
    var tier1 = isTier1Container(el);
    var tier2 = !tier1 && (!!BLOCK_TAGS[el.tagName] || isLeafBlock(el));

    if (tier1 || tier2) {
      if (CFG.mode === 'rtl') dir = 'rtl';
      else if (CFG.mode === 'ltr') dir = 'ltr';
      else {
        var text = gatherText(el);
        var sig = text.length + '|' + text.slice(-40);
        if (sigCache.get(el) === sig) dir = null;
        else {
          sigCache.set(el, sig);
          dir = decideDirection(text);
        }
      }
      if (dir) applyDirection(el, dir);
    }

    // Shadow DOM support: observe open shadow roots we encounter.
    if (CFG.shadows && el.shadowRoot) registerShadowRoot(el.shadowRoot);
  }

  /* ------------------------------------------------------------------ *
   * 7. Mutation processing queue
   * ------------------------------------------------------------------ */
  var queue = [];
  var queued = new WeakSet();
  var scheduled = false;
  var FLUSH_BUDGET = 250; // elements per frame — keeps the UI smooth on huge chats
  var MAX_EXPAND = 1500;   // max nodes pulled from one added subtree per flush

  /* ==========================================================================
   * ۸) صف پردازش و MutationObserver
   * --------------------------------------------------------------------------
   * MutationObserver یک API مرورگر است که «تغییرات صفحه» را گزارش می‌دهد:
   * پیام جدید اضافه شد، متن در حال استریم عوض شد، دکمه‌ای ساخته شد…
   *
   * چرا صف؟ چون در چت‌های بزرگ، پردازش هم‌زمان صدها المان باعث لگ می‌شود.
   * پس تغییرات را جمع می‌کنیم و در هر فریم فقط ۲۵۰ المان را پردازش می‌کنیم.
   * ========================================================================== */
  function enqueue(el) {
    if (!el || el.nodeType !== 1 || queued.has(el) || !el.isConnected) return;
    queued.add(el);
    queue.push(el);
    schedule();
  }

  /* یک کل درخت تازه‌اضافه‌شده را در صف می‌ریزد (پیمایش عمقی).
   * شاخه‌های کد/ترمینال را هرس می‌کند تا وقت هدر نرود. */
  function enqueueTree(root) {
    if (!root || root.nodeType !== 1) return;
    var stack = [root];
    var pulled = 0;
    while (stack.length && pulled < MAX_EXPAND) {
      var node = stack.pop();
      pulled++;
      enqueue(node);
      var children = node.children;
      if (children && children.length) {
        if (shouldSkipSubtree(node)) continue; // prune big code/terminal subtrees
        for (var i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
      if (node.shadowRoot) enqueueTree(node.shadowRoot);
    }
  }

  function nearestCandidate(el) {
    var node = el;
    for (var depth = 0; node && node.nodeType === 1 && depth < 14; depth++) {
      if (node.hasAttribute && (node.hasAttribute('data-rtl-dir') ||
          BLOCK_TAGS[node.tagName] || isTier1Container(node))) return node;
      node = node.parentElement;
    }
    return el;
  }

  /* چند المان از صف را پردازش می‌کند. از WeakSet ها خارج می‌کنیم تا اگر
   * متن همان المان بعداً عوض شد (استریم)، دوباره قابل اضافه‌شدن باشد. */
  function flush() {
    scheduled = false;
    var budget = FLUSH_BUDGET;
    while (queue.length && budget-- > 0) {
      var el = queue.shift();
      queued.delete(el); // allow re-processing after streaming text changes
      processElement(el);
    }
    if (queue.length) schedule();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  }

  /* رویدادهای MutationObserver را به صف تبدیل می‌کند:
   *   characterData → متن عوض شده (استریم) → نزدیک‌ترین بلوک را دوباره بررسی کن
   *   childList     → گره‌های جدید → کل زیردرختشان را صف کن */
  function onMutations(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === 'characterData') {
        var parent = m.target.parentElement;
        if (parent) {
          enqueue(nearestCandidate(parent));
          var mono = parent.closest && parent.closest('.monaco-editor');
          if (mono) updateMonacoChatInput(mono);
        }
      } else if (m.type === 'childList') {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node.nodeType === 1) {
            enqueueTree(node);
          } else if (node.nodeType === 3 && node.parentElement) {
            enqueue(nearestCandidate(node.parentElement));
          }
        }
        // Monaco input typing mutates inside editors we normally skip.
        if (m.target && m.target.nodeType === 1) {
          var monaco = m.target.closest && m.target.closest('.monaco-editor');
          if (monaco) updateMonacoChatInput(monaco);
        }
      }
    }
  }

  var observer = null;
  var shadowObservers = [];
  var shadowRoots = [];

  function startObserver(target) {
    var obs = new MutationObserver(onMutations);
    obs.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: false
    });
    return obs;
  }

  /* Shadow DOM: کامپوننت‌های وب یک DOM «مخفی» داخل خودشان دارند.
   * MutationObserver بیرونی تغییرات داخل آن را نمی‌بیند، پس برای هر Shadow Root
   * یک observer جدا می‌سازیم. اگر مرورگر اجازه ندهد، بی‌صدا رد می‌شویم. */
  function registerShadowRoot(root) {
    if (!root || root.__rtlUniversal) return;
    root.__rtlUniversal = true;
    shadowRoots.push(root);
    try {
      ensureStyles(root);
      shadowObservers.push(startObserver(root));
      enqueueTree(root);
      var all = root.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) registerShadowRoot(all[i].shadowRoot);
      }
    } catch (e) { /* ignore closed/inaccessible roots */ }
  }

  /* برخی کامپوننت‌ها Shadow Root را «بعداً» می‌سازند. با wrap کردن
   * Element.prototype.attachShadow می‌توانیم لحظه‌ی ساخت را بفهمیم و
   * بلافاصله observer را نصب کنیم. (بدون شکستن رفتار اصلی.) */
  function patchAttachShadow() {
    if (!CFG.shadows || !Element.prototype.attachShadow || Element.prototype.attachShadow.__rtlUniversal) return;
    var original = Element.prototype.attachShadow;
    var patched = function (init) {
      var root = original.call(this, init);
      try {
        if (root && (init === undefined || init.mode !== 'closed')) registerShadowRoot(root);
      } catch (e) { /* ignore */ }
      return root;
    };
    patched.__rtlUniversal = true;
    Element.prototype.attachShadow = patched;
  }

  /* ------------------------------------------------------------------ *
   * 8. Start / stop / public API
   * ------------------------------------------------------------------ */
  /* ==========================================================================
   * ۹) شروع، اسکن کامل و چرخه‌ی عمر
   * --------------------------------------------------------------------------
   * fullScan کل صفحه را یک‌بار می‌پیماید (حداکثر ۸۰۰۰ گره) و برای هر المان
   * processElement را صدا می‌زند. بعد از آن، MutationObserver تغییرات آینده را
   * پوشش می‌دهد، پس نیازی به اسکن مکرر نیست.
   * ========================================================================== */
  function fullScan() {
    if (!CFG.enabled) return;
    var body = document.body;
    if (!body) return;
    ensureStyles(document);
    var stack = [body];
    var count = 0;
    while (stack.length && count < 8000) {
      var node = stack.pop();
      count++;
      processElement(node);
      if (node.shadowRoot) registerShadowRoot(node.shadowRoot);
      if (shouldSkipSubtree(node)) continue;
      var children = node.children;
      if (children) {
        for (var i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
    }
  }

  function reprocessAll() {
    var marked = document.querySelectorAll('[data-rtl-dir]');
    for (var i = 0; i < marked.length; i++) {
      restoreElement(marked[i]);
    }
    sigCache = new WeakMap();
    fullScan();
  }

  /* راه‌اندازی: استایل + patch کردن attachShadow + observer + اسکن اولیه. */
  function start() {
    if (!CFG.enabled) return;
    ensureStyles(document);
    patchAttachShadow();
    observer = startObserver(document.documentElement);
    fullScan();
    if (document.body) {
      // Open shadow roots present on initial load.
      var hosts = document.body.querySelectorAll('*');
      for (var i = 0; i < hosts.length && i < 5000; i++) {
        if (hosts[i].shadowRoot) registerShadowRoot(hosts[i].shadowRoot);
      }
    }
  }

  /* توقف کامل: قطع observerها، بازگردانی همه‌ی dirها و حذف استایل‌ها. */
  function destroy() {
    if (observer) { observer.disconnect(); observer = null; }
    for (var i = 0; i < shadowObservers.length; i++) shadowObservers[i].disconnect();
    shadowObservers = [];
    restoreAll();
    var style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    for (var j = 0; j < shadowRoots.length; j++) {
      try {
        var s = shadowRoots[j].querySelector && shadowRoots[j].querySelector('style#' + STYLE_ID);
        if (s) s.remove();
      } catch (e) { /* ignore */ }
    }
    shadowRoots = [];
    global.__RTL_UNIVERSAL_LOADED__ = false;
  }

  /* ==========================================================================
   * ۱۰) API عمومی
   * --------------------------------------------------------------------------
   * این شیء در window قرار می‌گیرد تا از کنسول DevTools هم بتوانی موتور را
   * کنترل کنی؛ مثلاً:
   *     RTLUniversal.setMode('rtl')
   *     RTLUniversal.stats
   *     RTLUniversal.decide('سلام دنیا')
   * ========================================================================== */
  global.RTLUniversal = {
    version: VERSION,
    get config() { return Object.assign({}, CFG); },
    get stats() { return Object.assign({}, stats); },
    decide: decideDirection,
    refresh: function () { reprocessAll(); },
    setMode: function (mode) {
      if (['smart', 'rtl', 'ltr'].indexOf(mode) === -1) return;
      CFG.mode = mode;
      reprocessAll();
    },
    setConfig: function (patch) {
      Object.assign(CFG, patch || {});
      if (!CFG.enabled) { destroy(); return; }
      var old = document.getElementById(STYLE_ID);
      if (old) old.remove();
      var oldShadow = shadowRoots.slice();
      for (var i = 0; i < oldShadow.length; i++) {
        try {
          var s = oldShadow[i].querySelector && oldShadow[i].querySelector('style#' + STYLE_ID);
          if (s) s.remove();
        } catch (e) { /* ignore */ }
      }
      ensureStyles(document);
      for (var j = 0; j < oldShadow.length; j++) ensureStyles(oldShadow[j]);
      reprocessAll();
    },
    injectCSS: function (css) {
      CFG.extraCSS = (CFG.extraCSS ? CFG.extraCSS + '\n' : '') + String(css || '');
      var s = document.getElementById(STYLE_ID);
      if (s) s.textContent = styleCSS();
    },
    disable: function () { CFG.enabled = false; destroy(); },
    enable: function () {
      if (CFG.enabled && observer) return;
      CFG.enabled = true;
      start();
    },
    destroy: destroy
  };

  /* Boot / شروع موتور
   * Normal builds start immediately. A browser extension may set
   * __RTL_UNIVERSAL_DEFER_START__ before loading this file; it then reads saved
   * per-site preferences and calls RTLUniversal.enable() only when appropriate.
   * نسخه‌های عادی موتور بلافاصله شروع می‌شوند. افزونه‌ی مرورگر می‌تواند پیش از
   * بارگذاری، این پرچم را روشن کند تا بعد از خواندن تنظیم‌های سایت شروع کنیم.
   */
  if (!global.__RTL_UNIVERSAL_DEFER_START__) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
      // Style early to avoid FOUC once head exists.
      if (document.head) ensureStyles(document);
    } else {
      start();
    }
  }
})(typeof window !== 'undefined' ? window : this);
