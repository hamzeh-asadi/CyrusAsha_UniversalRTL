#!/usr/bin/env node
/**
 * Builds a branded VSIX package without any external tooling.
 * Run: npm run build:vsix
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createZip } = require('../tools/zip');

const EXT_DIR = __dirname;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'release');
const ENGINE_SRC = path.join(ROOT, 'src', 'engine', 'rtl-engine.js');

function read(p) { return fs.readFileSync(p); }
function writeRel(map, rel, data) { map.set(rel, data); }

/* ============================================================================
 * VSIX چیست؟
 * ----------------------------------------------------------------------------
 * VSIX یک فایل ZIP با ساختار مشخص است که IDE آن را به‌عنوان افزونه می‌شناسد:
 *   extension.vsixmanifest   → شناسنامه (نام، نسخه، ناشر)
 *   [Content_Types].xml      → نوع فایل‌های داخل بسته
 *   extension/               → خود افزونه (package.json + کد + آیکون + متن‌ها)
 *
 * این اسکریپت بدون نیاز به vsce (ابزار رسمی) همین بسته را می‌سازد.
 * ========================================================================== */
function main() {
  const pkg = JSON.parse(read(path.join(EXT_DIR, 'package.json'), 'utf8'));
  if (!pkg.publisher || !pkg.name || !pkg.version) {
    throw new Error('package.json نیاز به name/version/publisher دارد');
  }

  // Fresh engine copy.
  const mediaEngine = path.join(EXT_DIR, 'media', 'rtl-engine.js');
  fs.mkdirSync(path.dirname(mediaEngine), { recursive: true });
  fs.copyFileSync(ENGINE_SRC, mediaEngine);

  const version = pkg.version;
  const id = pkg.name;

  const files = new Map();
  writeRel(files, 'extension/package.json', read(path.join(EXT_DIR, 'package.json')));
  writeRel(files, 'extension/extension.js', read(path.join(EXT_DIR, 'extension.js')));
  writeRel(files, 'extension/media/rtl-engine.js', read(mediaEngine));
  writeRel(files, 'extension/media/icon.png', read(path.join(EXT_DIR, 'media', 'icon.png')));

  // فایل‌های ترجمه (nls): VS Code بر اساس زبان رابط کاربر، یکی را انتخاب می‌کند.
  // package.nls.json = انگلیسی (پیش‌فرض)   |   package.nls.fa.json = فارسی
  ['package.nls.json', 'package.nls.fa.json'].forEach((name) => {
    const p = path.join(EXT_DIR, name);
    if (fs.existsSync(p)) writeRel(files, 'extension/' + name, read(p));
  });

  const readme = path.join(EXT_DIR, 'README.md');
  if (fs.existsSync(readme)) writeRel(files, 'extension/README.md', read(readme));
  const changelog = path.join(EXT_DIR, 'CHANGELOG.md');
  if (fs.existsSync(changelog)) writeRel(files, 'extension/CHANGELOG.md', read(changelog));
  const license = path.join(EXT_DIR, 'LICENSE.txt');
  if (fs.existsSync(license)) writeRel(files, 'extension/LICENSE.txt', read(license));

  // propertyهای بسته. اگر package.nls.fa.json وجود داشته باشد، IDE در حالت
  // فارسی همین مقادیر فارسی را نشان می‌دهد.
  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${version}" Publisher="${pkg.publisher}" />
    <DisplayName>${escapeXml(pkg.displayName || pkg.name)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(pkg.description || '')}</Description>
    <Tags>${(pkg.keywords || []).join(',')}</Tags>
    <Categories>${(pkg.categories || ['Other']).join(',')}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(pkg.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
    </Properties>
    <Icon>extension/media/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`;
  const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".png" ContentType="image/png"/>
  <Default Extension=".md" ContentType="text/markdown"/>
  <Default Extension=".txt" ContentType="text/plain"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>
`;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: 'extension.vsixmanifest', data: manifest },
    ...Array.from(files.entries()).map(([name, data]) => ({ name, data }))
  ];

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outName = `${pkg.publisher}.${id}-${version}.vsix`;
  const outPath = path.join(OUT_DIR, outName);
  createZip(entries, outPath);

  const size = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log('✅ ساخته شد: release/' + outName + '  (' + size + ' KB)');
  console.log('   نصب در Antigravity / VS Code:');
  console.log('   code --install-extension release/' + outName);
  console.log('   یا از منوی Extensions → … → Install from VSIX');
  return outPath;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('❌ ' + e.message); process.exit(1); }
}

module.exports = { main };
