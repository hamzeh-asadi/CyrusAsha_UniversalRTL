# Builds and release artifacts / ساخت و بسته‌های انتشار

**CyrusAsha_UniversalRTL-1.0.0 · version `1.0.0`**

## فارسی

### پیش‌نیازهای ساخت

برای ساخت معمول پروژه Node.js و npm نصب کنید و وابستگی‌های ثبت‌شده را دریافت کنید:

```bash
npm ci
```

`package-lock.json` نسخه‌ی دقیق وابستگی‌ها را تثبیت می‌کند. ساخت بسته‌ی Windows علاوه بر آن، برای دریافت Node.js رسمی Windows به اینترنت نیاز دارد.

### فرمان‌های ساخت

| فرمان | خروجی / کار |
| --- | --- |
| `npm run build:assets` | userscript، bookmarklet، snippet کنسول و `demo/index.html` |
| `npm run build:vsix` | بسته‌ی VS Code در `release/` |
| `npm run build:browser` | بسته‌ی Chrome ZIP، بسته‌ی Firefox XPI و پوشه‌های unpacked توسعه/lint |
| `npm run build:chrome-crx` | CRX3 packed از پوشه‌ی ساخته‌شده‌ی Chrome؛ ابتدا `npm run build:browser` را اجرا کنید |
| `npm run pack:chrome` | ساخت مجدد افزونه‌ی مرورگر و سپس تولید CRX3 |
| `npm run build` | همه‌ی خروجی‌های وب، VSIX، بسته‌های مرورگر و CRX3 محلی Chrome |
| `npm run build:win` | ZIP قابل‌حمل Windows شامل برنامه و بسته‌های نسخه‌دار |
| `npm run lint:firefox` | ساخت افزونه و اجرای `web-ext lint` روی منبع Firefox تولیدشده |

پوشه‌ی توسعه‌ی مرورگرها برای آزمون و lint لازم است، اما CRX محصول Chrome به‌شکل **packed** ساخته می‌شود. آرشیو کامل پروژه و بسته‌ی portable پوشه‌های unpacked را به‌عنوان افزونه‌ی قابل‌نصب عرضه نمی‌کنند.

### امضای Chrome و Firefox

ساخت CRX محلی از کلید RSA پایدار استفاده می‌کند. مسیر پیش‌فرض کلید خصوصی:

```text
~/.rtl-universal/CyrusAsha_UniversalRTL-chrome-signing.pem
```

در صورت نیاز می‌توان مسیر دیگری را با متغیر محیطی `RTL_CHROME_EXTENSION_KEY` تعیین کرد. کلید خصوصی را در مخزن، ZIP عمومی یا پیام‌رسان قرار ندهید؛ برای حفظ شناسه‌ی همان CRX، کلید را به‌صورت امن پشتیبان‌گیری کنید. CRX محلی، انتشار Chrome Web Store یا امضای فروشگاه را انجام نمی‌دهد؛ انتشار عمومی به فرایند فروشگاه نیاز دارد.

نسخه‌ی عمومی `1.0.0` افزونه‌ی Firefox در صفحه‌ی رسمی [Firefox Add-ons (AMO)](https://addons.mozilla.org/en-US/firefox/addon/cyrusasha_universalrtl/) منتشر شده و برای نصب معمول از همان صفحه استفاده کنید. فایل `.xpi` محلی که builder تولید می‌کند امضای AMO ندارد و فقط برای آزمون است. برای نسخه‌ی انتشار تازه، `npm run sign:firefox` را با اعتبارنامه‌های AMO اجرا کنید؛ امضا یا submission بخشی از ساخت عادی نیست.

### Windows portable

`npm run build:win` خروجی‌های نسخه‌دار را دوباره می‌سازد، کد GUI را bundle می‌کند، Node.js رسمی Windows را دریافت می‌کند و یک ZIP در `release/windows/` می‌سازد. برای استفاده، ZIP را استخراج و `Start.bat` را اجرا کنید. اگر اپ هدف در `Program Files` نصب شده، پنل را با دسترسی Administrator اجرا کنید؛ برنامه‌ی هدف را هم پیش از پچ کاملاً ببندید. پنل تازه پچ‌های قدیمی را «نیازمند به‌روزرسانی» نشان می‌دهد و دکمه‌ی به‌روزرسانی ارائه می‌کند. فایل‌های launcher در مخزن باید ASCII و CRLF بمانند؛ آزمون‌های `test/launchers.test.js` و `test/windows.test.js` این قراردادها و مسیرهای آن‌ها را بررسی می‌کنند.

### آزمون‌ها و lint

```bash
npm run test:all
npm run test:gui
node test/gui-i18n.test.js
node test/browser-demo.test.js
npm run lint:firefox
```

`test:all` شامل آزمون‌های موتور، ASAR، patcher، افزونه‌ی VS Code، Windows، launcherها و Chrome/Firefox است. آزمون GUI و demo جداگانه‌اند و به مرورگر Playwright نیاز دارند؛ یک‌بار `npx playwright install chromium` اجرا کنید (در Linux، در صورت نیاز `npx playwright install-deps chromium` نیز لازم است). `test/browser-extension.test.js` علاوه بر manifestها، مجوزهای میزبان اختیاری، درخواست/لغو مجوز سایت دلخواه و ثبت پویای اسکریپت را شبیه‌سازی می‌کند؛ این آزمون‌ها امضای فروشگاه یا نصب روی حساب واقعی مرورگر را شبیه‌سازی نمی‌کنند.

## English

### Build requirements

Install Node.js and npm, then install the locked dependencies:

```bash
npm ci
```

`package-lock.json` pins dependency versions. Building the Windows package also requires network access to download the official Windows Node.js runtime.

### Build commands

| Command | Output / action |
| --- | --- |
| `npm run build:assets` | Userscript, bookmarklet, console snippet, and `demo/index.html` |
| `npm run build:vsix` | VS Code package under `release/` |
| `npm run build:browser` | Chrome ZIP, Firefox XPI, and unpacked development/lint folders |
| `npm run build:chrome-crx` | Packed CRX3 from the generated Chrome folder; run `npm run build:browser` first |
| `npm run pack:chrome` | Rebuild the browser extension, then generate the CRX3 |
| `npm run build` | Web assets, VSIX, browser packages, and a locally packed Chrome CRX3 |
| `npm run build:win` | Portable Windows ZIP with versioned application packages |
| `npm run lint:firefox` | Build the extension and run `web-ext lint` on the generated Firefox source |

Unpacked browser folders are retained for development and linting; the Chrome product CRX is **packed**. The full-project archive and portable package do not present the unpacked folders as installable release add-ons.

### Chrome and Firefox signing

The local Chrome CRX builder uses a persistent RSA key. The default private-key path is:

```text
~/.rtl-universal/CyrusAsha_UniversalRTL-chrome-signing.pem
```

Set `RTL_CHROME_EXTENSION_KEY` to use another path. Never place the private key in the repository, a public ZIP, or a messaging service. Back it up securely if the same CRX identity must be retained. A locally packed CRX does not publish or sign the extension through the Chrome Web Store; public distribution requires the store process.

The public `1.0.0` Firefox extension is available from the official [Firefox Add-ons (AMO) listing](https://addons.mozilla.org/en-US/firefox/addon/cyrusasha_universalrtl/); use that page for a normal install. The locally generated `.xpi` is unsigned and intended only for testing. For a new signed release, run `npm run sign:firefox` with AMO credentials; signing and submission are not part of the normal build.

### Portable Windows package

`npm run build:win` rebuilds versioned artifacts, bundles the GUI, downloads the official Windows Node.js runtime, and creates a ZIP under `release/windows/`. Extract the ZIP and run `Start.bat`. Run the Control Panel as Administrator when the target app is under `Program Files`, and fully close the target app before patching. The updated panel marks stale embedded engines as needing an update and offers an Update action. Keep repository launcher files ASCII and CRLF; `test/launchers.test.js` and `test/windows.test.js` validate those contracts and the referenced paths.

### Tests and lint

```bash
npm run test:all
npm run test:gui
node test/gui-i18n.test.js
node test/browser-demo.test.js
npm run lint:firefox
```

`test:all` covers the engine, ASAR, patcher, VS Code extension, Windows, launchers, and Chrome/Firefox extensions. GUI and demo tests are separate and use Playwright; install a browser once with `npx playwright install chromium` (on Linux, also run `npx playwright install-deps chromium` if system libraries are missing). `test/browser-extension.test.js` also exercises optional host permissions, custom-site permission request/removal, and dynamic registration with browser API mocks; it does not simulate store signing or installation into a real browser profile.
