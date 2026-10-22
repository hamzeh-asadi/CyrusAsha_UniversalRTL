# Architecture / معماری

**CyrusAsha_UniversalRTL-1.0.0 · 1.0.0**

## فارسی

### تصویر کلی

پروژه یک موتور مشترک JavaScript دارد و آن را با پل‌های کوچک در چند محیط اجرا می‌کند. منبع اصلی موتور `src/engine/rtl-engine.js` است؛ خروجی‌های افزونه‌ی مرورگر، افزونه‌ی IDE، userscript و دموی وب از همین منبع ساخته می‌شوند.

```text
src/engine/rtl-engine.js
  ├─ browser-extension/ → افزونه‌های Chrome و Firefox
  ├─ vscode-extension/  → افزونه‌ی IDE و پچ Workbench
  ├─ src/patcher/       → پچ محلی برنامه‌های Electron
  ├─ scripts/           → userscript، bookmarklet، snippet و demo
  └─ src/gui/           → پنل کنترل محلی
```

### موتور جهت‌دهی

- حالت `smart` تعداد حروف قوی RTL و LTR را در حداکثر ۱۲۰ حرف قوی اول هر بلوک می‌شمارد. اگر سهم یک جهت دست‌کم ۵۵٪ باشد همان جهت برنده است؛ در بازه‌ی نزدیک به مساوی، نخستین حرف قوی مبناست. متن بدون حرف قوی تغییر نمی‌کند.
- حروف فارسی/عربی و عبری RTL تشخیص داده می‌شوند. بلوک‌های کد، ترمینال، ورودی‌ها، SVG، و نواحی ریاضی/مستثنا از تشخیص پیام کنار گذاشته می‌شوند.
- `rtl` و `ltr` حالت‌های اجباری‌اند. کادرهای متنی با `dir="auto"` ویرایش می‌شوند؛ پشتیبانی از ورودی Monaco به‌صورت best-effort و با بررسی زمینه‌ی چت انجام می‌شود.
- تغییرات DOM و پاسخ‌های تدریجی با `MutationObserver` دنبال می‌شوند. موتور از راه‌اندازی چندباره‌ی یک نمونه در همان صفحه جلوگیری می‌کند و هنگام خاموش‌شدن، نشانه‌ها و استایل‌های خود را پاک می‌کند.

### افزونه‌های Chrome و Firefox

`browser-extension/sites.json` منبع واحد شناسه‌ها، نام‌های دوزبانه، میزبان‌ها و الگوهای HTTPS سایت‌های آماده است. `scripts/build-browser-extension.js` آن را به `site-config.js` و `content_scripts.matches` تبدیل می‌کند و فایل‌های مشترک را در دو بسته قرار می‌دهد.

Manifest از `storage` و `scripting` استفاده می‌کند؛ `optional_host_permissions` به الگوی HTTPS محدود است و فهرست آماده همچنان از matchهای معین استفاده می‌کند. Chrome از Manifest V3 service worker بهره می‌برد و Firefox از Manifest V3 background script. حداقل نسخه‌های manifest در builder تعیین شده‌اند.

#### جریان سایت دلخواه

1. کاربر در popup دامنه یا URL وارد و دکمه‌ی افزودن را انتخاب می‌کند.
2. `popup.js` نشانی را اعتبارسنجی می‌کند، فقط HTTPS را می‌پذیرد و به hostname دقیق نرمال می‌کند. path، query و fragment مبنای مجوز نیستند؛ مجوز به شکل `https://<host>/*` است.
3. همان handler کاربر `permissions.request()` را برای همان host فراخوانی می‌کند. در صورت ردشدن مجوز، هیچ سایت جدیدی ذخیره نمی‌شود.
4. پس از تأیید، تنظیمات در `browser.storage.local` یا `chrome.storage.local` زیر کلید `rtlUniversalSettings` ذخیره می‌شوند. این شیء شامل وضعیت کلی، حالت، کلیدهای سایت‌ها، زبان popup و فهرست hostهای انتخاب‌شده است؛ متن صفحه یا گفت‌وگو جزو تنظیمات نیست.
5. `background.js` رویدادهای storage و permission، شروع مرورگر و نصب افزونه را دنبال می‌کند. ابتدا registration قبلی خود را حذف می‌کند، سپس فقط hostهایی را که هم در تنظیمات فعال‌اند و هم permission معتبر دارند ثبت می‌کند. ثبت پویا با `document_start` و `persistAcrossSessions` انجام می‌شود.
6. `content.js` فقط زمانی موتور را فعال می‌کند که hostname دقیق با سایت آماده یا `customSites` ذخیره‌شده تطبیق داشته باشد. حذف سایت، تنظیمات را پاک می‌کند، از مرورگر درخواست لغو همان permission را می‌دهد و محتوای تزریق‌شده‌ی برگه‌ی باز را غیرفعال می‌کند.

دامنه‌ی دلخواه شامل زیر‌دامنه‌ها نمی‌شود؛ برای هر میزبان باید جداگانه اقدام و مجوز گرفت. پشتیبانی custom-site در این نسخه فقط در افزونه‌های Chrome و Firefox وجود دارد. فهرست ثابت userscript یا لایه‌های دیگر از این بخش استفاده نمی‌کنند.

### محیط‌های دیگر

- **VS Code و فورک‌ها:** `vscode-extension/extension.js` تنظیمات و فرمان‌ها را می‌خواند و یک بلوک علامت‌گذاری‌شده به فایل Workbench محلی اضافه می‌کند. نسخه‌ی اولیه‌ی فایل پشتیبان می‌گیرد؛ افزونه می‌تواند پس از جایگزین‌شدن فایل در به‌روزرسانی، پچ را دوباره اعمال کند. حذف/غیرفعال‌سازی بلوک را از پشتیبان برمی‌گرداند یا در صورت نبود پشتیبان آن را جداگانه پاک می‌کند.
- **برنامه‌های Electron:** `src/patcher/patch-electron.js` مسیر `app.asar` را پیدا می‌کند، ساختار اصلی را بررسی می‌کند، فایل موتور و hook را به آرشیو اضافه و یک نسخه‌ی پشتیبان کنار فایل می‌سازد. GUI و CLI از همین patcher استفاده می‌کنند.
- **پنل کنترل:** `src/gui/server.js` یک HTTP server محلی و رابط فارسی/انگلیسی را اجرا می‌کند؛ مسیر پیش‌فرض `127.0.0.1:4477` است. تنظیمات آن در `~/.rtl-universal/config.json` (یا مسیر `RTL_UNIVERSAL_HOME`) نگهداری می‌شوند. سرور برای مدیریت فایل‌های نصب‌شده به دسترسی فایل‌سیستم محلی نیاز دارد.
- **خروجی‌های سبک وب:** `scripts/build-assets.js` یک userscript، bookmarklet، snippet کنسول و صفحه‌ی demo می‌سازد؛ demo از قالب HTML و همان موتور تولید می‌شود.

### فایل‌های کلیدی

| مسیر | نقش |
| --- | --- |
| `src/engine/rtl-engine.js` | موتور اصلی جهت‌دهی |
| `browser-extension/sites.json` | فهرست سایت‌های آماده برای افزونه‌های مرورگر |
| `browser-extension/popup.*` | رابط و رفتار تنظیمات مرورگر |
| `browser-extension/background.js` | ثبت/حذف پویا برای سایت‌های موردتأیید |
| `browser-extension/content.js` | خواندن تنظیمات و راه‌اندازی موتور در صفحه |
| `scripts/build-browser-extension.js` | تولید manifestها و بسته‌های Chrome/Firefox |
| `vscode-extension/` | manifest و کد افزونه‌ی VS Code |
| `src/patcher/` | ابزار patch/unpatch برای برنامه‌های Electron |
| `src/gui/` | پنل کنترل محلی |
| `test/` | آزمون‌های موتور، بسته‌بندی، Windows، GUI و افزونه‌ها |

### کنترل کیفیت

- `npm run test:all` آزمون‌های موتور، ASAR، patcher، افزونه‌ی VS Code، Windows، launcherها و افزونه‌های Chrome/Firefox را اجرا می‌کند.
- `npm run test:gui` آزمون‌های GUI را اجرا می‌کند؛ `node test/gui-i18n.test.js` زبان‌ها و `node test/browser-demo.test.js` رفتار demo را بررسی می‌کند.
- `npm run lint:firefox` ابتدا بسته‌های مرورگر را می‌سازد و سپس `web-ext lint` را روی منبع تولیدشده‌ی Firefox اجرا می‌کند.

## English

### Overview

The project has one shared JavaScript engine and small adapters for each host environment. The canonical source is `src/engine/rtl-engine.js`; the browser extension, IDE extension, userscript, and web demo are built from it.

```text
src/engine/rtl-engine.js
  ├─ browser-extension/ → Chrome and Firefox extensions
  ├─ vscode-extension/  → IDE extension and Workbench patch
  ├─ src/patcher/       → local Electron-app patching
  ├─ scripts/           → userscript, bookmarklet, snippet, and demo
  └─ src/gui/           → local control panel
```

### Direction engine

- In `smart` mode, the engine counts strong RTL and LTR letters among the first 120 strong characters in a block. A direction wins at a share of 55% or more; near ties use the first strong letter. Text without strong letters is left alone.
- Persian/Arabic and Hebrew letters are detected as RTL. Code, terminals, inputs, SVG, and math/excluded regions are kept out of message detection.
- `rtl` and `ltr` are force modes. Text inputs use `dir="auto"`; Monaco input support is best-effort and limited to chat contexts.
- `MutationObserver` handles DOM changes and streamed content. A single-instance guard prevents duplicate engine instances in one page; disabling restores the engine's own markers and styles.

### Chrome and Firefox extensions

`browser-extension/sites.json` is the single source of built-in IDs, bilingual labels, hosts, and HTTPS match patterns. `scripts/build-browser-extension.js` generates `site-config.js` and `content_scripts.matches`, then places the shared files into both packages.

The manifest uses `storage` and `scripting`; optional host permissions are HTTPS-only, while built-in sites remain on explicit match patterns. Chrome uses a Manifest V3 service worker; Firefox uses a Manifest V3 background script. Minimum browser versions are set by the builder.

#### Custom-site flow

1. The user enters a domain or URL in the popup and submits the form.
2. `popup.js` validates it, accepts HTTPS only, and normalizes it to an exact hostname. Path, query, and fragment do not narrow the permission; the pattern is `https://<host>/*`.
3. The submit handler calls `permissions.request()` for that host as a direct user action. A denied request does not add a site.
4. On approval, settings are saved in `browser.storage.local` or `chrome.storage.local` under `rtlUniversalSettings`. The record contains global state, mode, site switches, popup language, and selected hosts—not page or conversation text.
5. `background.js` listens to storage and permission events, browser startup, and extension installation. It removes its previous registration, then registers only hosts that are enabled in settings and have a current permission. The dynamic registration runs at `document_start` and persists across sessions.
6. `content.js` starts the engine only when the exact hostname matches a built-in site or a saved custom host. Removing a site clears its setting, asks the browser to revoke that host permission, and disables the injected engine in an already-open tab.

A custom host does not include its subdomains; add and approve each host separately. Custom-site support in this version is limited to the Chrome and Firefox extensions. It is not shared with the static userscript list or other adapters.

### Other environments

- **VS Code and forks:** `vscode-extension/extension.js` reads settings and commands, then appends a marked block to the local Workbench bundle. It backs up the original file; after an update replaces the bundle, the extension can apply the patch again. Disable/uninstall restores the backup or surgically removes the block when no backup is available.
- **Electron apps:** `src/patcher/patch-electron.js` resolves `app.asar`, checks the application structure, adds the engine and hook, and creates a sibling backup. The GUI and CLI use this patcher.
- **Control panel:** `src/gui/server.js` runs a local HTTP server and a Persian/English UI; its default address is `127.0.0.1:4477`. Settings are stored in `~/.rtl-universal/config.json` (or `RTL_UNIVERSAL_HOME`). Managing installed files requires local filesystem access.
- **Web assets:** `scripts/build-assets.js` creates a userscript, bookmarklet, console snippet, and demo page. The demo is assembled from an HTML template and the same engine.

### Key paths

| Path | Role |
| --- | --- |
| `src/engine/rtl-engine.js` | Canonical direction engine |
| `browser-extension/sites.json` | Built-in browser-site list |
| `browser-extension/popup.*` | Browser settings UI and behavior |
| `browser-extension/background.js` | Dynamic registration for approved sites |
| `browser-extension/content.js` | Settings bridge and page bootstrap |
| `scripts/build-browser-extension.js` | Chrome/Firefox manifests and packages |
| `vscode-extension/` | VS Code extension manifest and code |
| `src/patcher/` | Electron patch/unpatch tools |
| `src/gui/` | Local control panel |
| `test/` | Engine, packaging, Windows, GUI, and extension tests |

### Quality checks

- `npm run test:all` runs the engine, ASAR, patcher, VS Code extension, Windows, launcher, and Chrome/Firefox extension tests.
- `npm run test:gui` runs GUI tests; `node test/gui-i18n.test.js` checks localization, and `node test/browser-demo.test.js` checks the demo.
- `npm run lint:firefox` rebuilds the browser packages and runs `web-ext lint` on the generated Firefox source.
