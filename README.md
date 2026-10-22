# CyrusAsha_UniversalRTL-1.0.0

**نسخه / Version: `1.0.0`**  
**زبان‌های رابط / UI languages: فارسی و English**

## فارسی

`CyrusAsha_UniversalRTL-1.0.0` یک موتور سبک برای تشخیص جهت نوشتار در محیط‌های چت و ویرایشگرهای مبتنی بر Electron است. در حالت هوشمند، جهت هر بلوک متنی را از حروف آن تشخیص می‌دهد؛ متن فارسی، عربی و عبری راست‌چین می‌شود و کد، ترمینال و بخش‌های LTR دست‌نخورده می‌مانند. موتور جاوااسکریپت مستقل و بدون وابستگی خارجی است.

### قابلیت‌ها

- تشخیص هوشمند جهت هر پیام یا بلوک، به‌علاوه‌ی حالت اجباری RTL و LTR.
- پشتیبانی از محتوای پویا و به‌روزرسانی تدریجی صفحه با `MutationObserver`؛ پشتیبانی best-effort از Shadow DOM باز.
- نگه‌داشتن بلوک‌های کد، ترمینال و ریاضی در جهت مناسب خود؛ جهت‌دهی خودکار کادرهای متنی.
- افزونه‌های Chrome و Firefox با فهرست سایت‌های آماده، رابط فارسی/انگلیسی و پیوندهای مستقیم GitHub و Telegram سازنده.
- افزودن سایت دلخواه در افزونه‌های Chrome و Firefox؛ مجوز فقط پس از اقدام صریح کاربر و فقط برای میزبان HTTPS انتخاب‌شده درخواست می‌شود.
- افزونه‌ی VS Code و ویرایشگرهای هم‌خانواده، پچر اپ‌های Electron، پنل کنترل محلی، userscript و دموی مستقل.

### وب‌سایت‌های آماده در افزونه‌های مرورگر

فهرست از `browser-extension/sites.json` ساخته می‌شود و ۲۱ ورودی (۲۷ الگوی HTTPS) دارد: ChatGPT، Claude، Gemini، Google AI Studio، DeepSeek، Perplexity، Qwen، Grok، You.com، Microsoft Copilot، Poe، Kimi، Mistral، ChatGLM، Tencent Yuanbao، Alibaba Tongyi، LMArena، OpenRouter، Character.AI، Doubao و MiniMax. برخی ورودی‌ها به مسیر مشخصی محدودند؛ برای نمونه، Grok در `x.com` فقط روی مسیر Grok اجرا می‌شود و Copilot از `copilot.microsoft.com` استفاده می‌کند.

### نصب افزونه‌ی Chrome

- بسته‌ی اصلی Chrome فایل packed زیر است: `release/browser/CyrusAsha_UniversalRTL-1.0.0-Chrome.crx`. اگر نسخه‌ی Chrome شما نصب CRX محلی را مجاز می‌کند، آن را از صفحه‌ی `chrome://extensions` نصب کنید. بعضی نسخه‌ها یا سیاست‌های سازمانی نصب CRX خارج از Chrome Web Store را مسدود می‌کنند؛ برای توزیع عمومی باید افزونه در فروشگاه منتشر شود.
- `release/browser/CyrusAsha_UniversalRTL-1.0.0-Chrome.zip` بسته‌ی بارگذاری فروشگاه است و مستقیماً به‌عنوان پوشه نصب نمی‌شود. برای آزمون محلی، ZIP را استخراج و در `chrome://extensions` → **Load unpacked**، پوشه‌ی استخراج‌شده‌ای را انتخاب کنید که `manifest.json` مستقیماً داخل آن باشد.
- برای ساخت پوشه‌ی توسعه از سورس، `npm run build:browser` اجرا و در **Load unpacked** مسیر `release/browser/chrome-unpacked` را انتخاب کنید. آرشیو کامل پروژه عمداً این پوشه‌ی unpacked را شامل نمی‌شود؛ بسته‌ی انتشار Chrome همچنان CRX packed است.
- پوشه‌ی `browser-extension` (سورس) و پوشه‌ی والد `release/browser` فایل `manifest.json` در ریشه ندارند؛ انتخاب آن‌ها باعث خطای **Manifest file is missing or unreadable** می‌شود.
- در Edge، **Pack extension** برای ساخت CRX است، نه نصب CRX موجود. اگر می‌خواهید بسته‌ی تازه بسازید، ریشه‌ی `release/browser/chrome-unpacked` را بدهید. برای حفظ شناسه‌ی CRX قبلی باید همان کلید PEM خصوصی را هم انتخاب کنید؛ بدون آن Edge کلید تازه و شناسه‌ی دیگری می‌سازد. CRX نسخه‌دار پروژه از پیش packed است و برای نصبش نیازی به Pack extension نیست.

### افزودن سایت دلخواه در Chrome و Firefox

1. منوی افزونه را باز و بخش **افزودن سایت دلخواه / Add a custom site** را باز کنید.
2. یک دامنه یا نشانی HTTPS وارد کنید؛ برای نمونه `https://chat.example.com`.
3. مرورگر درخواست دسترسی همان میزبان را نمایش می‌دهد. اگر آن را تأیید کنید، سایت به فهرست محلی افزونه اضافه می‌شود.
4. صفحه‌ی سایت را بارگذاری مجدد کنید تا اسکریپت روی آن اجرا شود.

مجوز به **میزبان دقیق** محدود است و همه‌ی مسیرهای همان میزبان را پوشش می‌دهد؛ زیر‌دامنه‌ها خودکار مجاز نمی‌شوند. HTTP، نشانی دارای اطلاعات ورود، و پورت غیرپیش‌فرض پذیرفته نمی‌شود. با خاموش‌کردن کلید سایت، اجرای آن غیرفعال می‌شود؛ دکمه‌ی حذف نیز سایت را از تنظیمات پاک می‌کند و از مرورگر برای لغو مجوز میزبان درخواست می‌فرستد. اگر مرورگر لغو مجوز را نپذیرد، پنجره‌ی افزونه هشدار می‌دهد.

### اجرای رابط و دمو از سورس

به Node.js و npm نیاز است. از ریشه‌ی پروژه اجرا کنید:

```bash
npm ci
npm start
```

پنل کنترل به‌طور پیش‌فرض فقط روی همین رایانه و نشانی `http://127.0.0.1:4477` اجرا می‌شود و مرورگر پیش‌فرض را باز می‌کند. برای جلوگیری از بازشدن خودکار مرورگر:

```bash
npm start -- --no-open
```

دموی خودکفا را با `npm run demo` اجرا کنید و در `http://localhost:8080` ببینید؛ فایل `demo/index.html` نیز به‌تنهایی قابل بازکردن است.

### ساخت و آزمون

```bash
npm ci
npm run test:all
npm run test:gui
node test/gui-i18n.test.js
node test/browser-demo.test.js
npm run build
```

آزمون‌های GUI و demo به مرورگر Playwright نیاز دارند؛ یک‌بار `npx playwright install chromium` اجرا کنید. در Linux، اگر کتابخانه‌ی سیستمی کم بود، `npx playwright install-deps chromium` را هم اجرا کنید.

`npm run build` خروجی‌های وب، VSIX، بسته‌های Chrome/Firefox و CRX3 محلی Chrome را می‌سازد. برای اعتبارسنجی افزونه‌ی Firefox:

```bash
npm run lint:firefox
```

برای ساخت بسته‌ی Windows قابل‌حمل از `npm run build:win` استفاده کنید. این فرایند برای دریافت نسخه‌ی رسمی Node.js ویندوز به اینترنت نیاز دارد.

### خروجی‌های مهم

- `release/browser/CyrusAsha_UniversalRTL-1.0.0-Chrome.crx` — افزونه‌ی Chrome به‌شکل **CRX3 بسته‌بندی‌شده**؛ کلید امضای محلی خارج از مخزن نگهداری می‌شود.
- `release/browser/CyrusAsha_UniversalRTL-1.0.0-Chrome.zip` — ZIP افزونه برای بارگذاری در فروشگاه Chrome/Edge.
- `release/browser/CyrusAsha_UniversalRTL-1.0.0-Firefox.xpi` — بسته‌ی Firefox؛ XPI ساخته‌شده هنوز امضای AMO ندارد.
- `release/cyrusasha.universalrtl-1.0.0.vsix` — افزونه‌ی VS Code.
- `release/rtl-universal.user.js` — userscript برای مدیران userscript سازگار.
- `release/windows/` — خروجی Windows قابل‌حمل، در صورت اجرای `npm run build:win`.

پوشه‌های `chrome-unpacked` و `firefox-unpacked` خروجی‌های توسعه و lint هستند؛ CRX منتشرشده فایل packed است. ساخت CRX محلی جایگزین انتشار/امضای Chrome Web Store نیست. برای نصب عمومی در Firefox، XPI باید از طریق AMO امضا شود.

### Git و GitHub

- `.gitattributes` نرمال‌سازی فایل‌های متنی را در مخزن روی LF می‌گذارد و برای فایل‌های `.bat` و `.cmd` در Windows، CRLF نگه می‌دارد.
- `.gitignore` موارد تولیدی `node_modules/`، `build/` و `release/` و فایل‌های کلید `.pem` را نادیده می‌گیرد. بسته‌های انتشار را بهتر است به GitHub Releases پیوست کنید، نه تاریخچه‌ی سورس.

### حریم خصوصی و محدودیت‌ها

- افزونه‌ی مرورگر برای تشخیص جهت، متن DOM صفحه را روی همان دستگاه پردازش می‌کند؛ محتوای گفت‌وگو را در storage ذخیره نمی‌کند و به سرور یا سرویس تحلیلی نمی‌فرستد.
- افزونه در نصب اولیه مجوز میزبان همگانی نمی‌گیرد. مجوز سایت دلخواه هنگام افزودن، با انتخاب کاربر و برای یک میزبان HTTPS مشخص درخواست می‌شود.
- تنظیمات پنل کنترل در `~/.rtl-universal/config.json` ذخیره می‌شوند؛ داده‌های گفت‌وگو بخشی از آن نیستند.
- پچر Electron و افزونه‌ی VS Code تغییرهایی در فایل‌های نصب محلی اعمال می‌کنند و نسخه‌ی پشتیبان می‌سازند. پیش از پچ، برنامه را کاملاً ببندید؛ امکان بازگردانی از رابط یا ابزار مربوط وجود دارد. بعضی به‌روزرسانی‌های برنامه ممکن است پچ را بازنویسی کنند.
- userscript از فهرست سایت‌های تعبیه‌شده استفاده می‌کند؛ بخش «سایت دلخواه» فقط در افزونه‌های Chrome و Firefox پیاده‌سازی شده است.

مجوز پروژه: MIT؛ جزئیات در [`LICENSE`](LICENSE).

---

## English

`CyrusAsha_UniversalRTL-1.0.0` is a small direction-detection engine for chat interfaces and Electron-based editors. Smart mode determines direction from the letters in each text block: Persian, Arabic, and Hebrew are aligned RTL, while code, terminals, and LTR regions remain intact. The JavaScript engine has no external runtime dependencies.

### Features

- Per-message or per-block smart direction, plus forced RTL and LTR modes.
- Handles dynamic and streaming page updates with `MutationObserver`; best-effort support for open Shadow DOM roots.
- Preserves code, terminal, and math regions; automatically sets direction for text inputs.
- Chrome and Firefox extensions with a built-in site list, Persian/English UI, and direct GitHub/Telegram links to the developer.
- Custom sites in the Chrome and Firefox extensions. A host permission is requested only after an explicit user action and only for the selected HTTPS host.
- A VS Code-family extension, Electron app patcher, local control panel, userscript, and standalone demo.

### Built-in browser sites

The browser list is generated from `browser-extension/sites.json` and contains 21 entries (27 HTTPS match patterns): ChatGPT, Claude, Gemini, Google AI Studio, DeepSeek, Perplexity, Qwen, Grok, You.com, Microsoft Copilot, Poe, Kimi, Mistral, ChatGLM, Tencent Yuanbao, Alibaba Tongyi, LMArena, OpenRouter, Character.AI, Doubao, and MiniMax. Some entries are restricted to a route; for example, the Grok match on `x.com` is limited to the Grok path. Microsoft Copilot uses `copilot.microsoft.com`.

### Install the Chrome extension

- The packed Chrome release is `release/browser/CyrusAsha_UniversalRTL-1.0.0-Chrome.crx`. If your Chrome build permits local CRX installation, install it from `chrome://extensions`. Some Chrome versions and enterprise policies block CRXs distributed outside the Chrome Web Store; public distribution requires a store release.
- `release/browser/CyrusAsha_UniversalRTL-1.0.0-Chrome.zip` is a store-upload package, not a folder to select directly. For local testing, extract it, open `chrome://extensions` → **Load unpacked**, and select the extracted folder with `manifest.json` directly inside it.
- To generate a development folder from source, run `npm run build:browser`, then select `release/browser/chrome-unpacked` with **Load unpacked**. The full-project archive intentionally omits this unpacked folder; the Chrome release package remains a packed CRX.
- The `browser-extension` source folder and the parent `release/browser` folder do not have a root-level `manifest.json`; selecting either causes **Manifest file is missing or unreadable**.
- In Edge, **Pack extension** creates a CRX; it does not install an existing CRX. If you need to build a new package, use `release/browser/chrome-unpacked` as the root. To preserve an existing CRX ID, you must also provide its original private PEM key; without it, Edge creates a new key and a different ID. The versioned CRX in this project is already packed, so it does not need to be repacked before installation.

### Add a custom site in Chrome or Firefox

1. Open the extension popup and expand **Add a custom site / افزودن سایت دلخواه**.
2. Enter an HTTPS domain or URL, such as `https://chat.example.com`.
3. The browser asks for access to that host. The extension stores the site only if you grant the request.
4. Reload the site tab for the content script to run.

Permission is limited to the **exact host** and covers all paths on that host; subdomains are not automatically included. HTTP, URLs containing credentials, and non-default ports are rejected. Turning off a site disables it. Removing a site deletes it from the extension settings and asks the browser to revoke its host permission; the popup warns if revocation fails.

### Run the UI and demo from source

Node.js and npm are required. From the project root:

```bash
npm ci
npm start
```

The control panel binds to `http://127.0.0.1:4477` by default and opens the default browser. It listens only on the local machine. To suppress automatic browser launch:

```bash
npm start -- --no-open
```

Run the self-contained demo with `npm run demo` and visit `http://localhost:8080`. You can also open `demo/index.html` directly.

### Build and test

```bash
npm ci
npm run test:all
npm run test:gui
node test/gui-i18n.test.js
node test/browser-demo.test.js
npm run build
```

GUI and demo tests use a Playwright browser; install it once with `npx playwright install chromium`. On Linux, if system libraries are missing, also run `npx playwright install-deps chromium`.

`npm run build` produces the web assets, VSIX, Chrome/Firefox packages, and a locally packed Chrome CRX3. To lint the Firefox extension:

```bash
npm run lint:firefox
```

Build the portable Windows package with `npm run build:win`. That build needs an internet connection to download the official Windows Node.js runtime.

### Key artifacts

- `release/browser/CyrusAsha_UniversalRTL-1.0.0-Chrome.crx` — a **packed CRX3** Chrome extension; its local signing key is kept outside the repository.
- `release/browser/CyrusAsha_UniversalRTL-1.0.0-Chrome.zip` — Chrome/Edge store-upload ZIP.
- `release/browser/CyrusAsha_UniversalRTL-1.0.0-Firefox.xpi` — Firefox package; the generated XPI is not yet signed by AMO.
- `release/cyrusasha.universalrtl-1.0.0.vsix` — VS Code extension package.
- `release/rtl-universal.user.js` — userscript for a compatible userscript manager.
- `release/windows/` — portable Windows output, after running `npm run build:win`.

The `chrome-unpacked` and `firefox-unpacked` directories are development/lint outputs; the release CRX is packed. A locally generated CRX does not replace Chrome Web Store publication/signing. A Firefox XPI intended for normal release installation must be signed through AMO.

### Git and GitHub

- `.gitattributes` normalizes repository text to LF and preserves CRLF in Windows `.bat` and `.cmd` files.
- `.gitignore` excludes generated `node_modules/`, `build/`, and `release/` folders and `.pem` keys. Attach release packages to GitHub Releases rather than storing them in source history.

### Privacy and limitations

- The browser extension processes page DOM text locally to determine direction. It does not save conversation text in extension storage or send it to a server or analytics service.
- The extension does not request a blanket host permission at installation. When you add a custom site, it asks for one HTTPS host after your action.
- Control-panel settings are saved in `~/.rtl-universal/config.json`; conversation data is not part of that file.
- The Electron patcher and VS Code extension modify local installed files and create backups. Fully close the target app before patching. The changes can be reverted with the corresponding UI/tool; application updates may overwrite a patch.
- The userscript uses its built-in match list. Custom-site management is implemented only in the Chrome and Firefox extensions.

Licensed under MIT; see [`LICENSE`](LICENSE).
