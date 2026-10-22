/**
 * Cross-validation of our dependency-free ASAR implementation against @electron/asar.
 * Run: node test/asar.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
/* ============================================================================
 * چرا این تست مهم است؟
 * ----------------------------------------------------------------------------
 * ما ASAR را خودمان پیاده کرده‌ایم (بدون وابستگی npm). اگر فرمت آن اشتباه
 * باشد، پچر می‌تواند یک اپ واقعی را خراب کند. برای همین خروجی خودمان را با
 * کتابخانه‌ی رسمی @electron/asar «رفت‌و‌برگشت» (round-trip) می‌کنیم:
 *   - آرشیوی که ما می‌سازیم، باید با ابزار رسمی خوانده شود.
 *   - آرشیوی که ابزار رسمی می‌سازد، باید با ما خوانده شود.
 * ========================================================================== */
const official = require('@electron/asar');
const ours = require('../src/patcher/asar');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; failures.push({ name, error: e }); console.log('  \u2717 ' + name + ' — ' + e.message); }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-asar-'));
  fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(root, 'empty-dir'), { recursive: true });
  fs.writeFileSync(path.join(root, 'main.js'), "const { app } = require('electron');\nconsole.log('hello');\n");
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fake-app', version: '1.2.3', main: 'main.js' }));
  fs.writeFileSync(path.join(root, 'src', 'deep', 'util.js'), 'module.exports = 42; // سلام دنیا\n');
  fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3, 250, 251, 252, 253]));
  fs.writeFileSync(path.join(root, 'empty.txt'), '');
  fs.chmodSync(path.join(root, 'main.js'), 0o755);
  return root;
}

(async function main() {
  console.log('\nASAR compatibility tests (ours <-> @electron/asar)\n');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-asar-out-'));

  await test('official reader can read archives written by us', async () => {
    const src = fixture();
    const archive = path.join(tmp, 'ours.asar');
    ours.createPackageFromDirectory(src, archive);
    const list = official.listPackage(archive);
    assert.deepStrictEqual(
      list.map((p) => p.replace(/\\/g, '/')).sort(),
      ['/binary.bin', '/empty-dir', '/empty.txt', '/main.js', '/package.json', '/src', '/src/deep', '/src/deep/util.js'].sort()
    );
    const main = official.extractFile(archive, 'main.js').toString();
    assert.strictEqual(main, fs.readFileSync(path.join(src, 'main.js'), 'utf8'));
    const util = official.extractFile(archive, 'src/deep/util.js').toString();
    assert.ok(util.includes('سلام دنیا'));
    const bin = official.extractFile(archive, 'binary.bin');
    assert.deepStrictEqual([...bin], [0, 1, 2, 3, 250, 251, 252, 253]);
  });

  await test('we can extract archives written by official library', async () => {
    const src = fixture();
    const archive = path.join(tmp, 'official.asar');
    await official.createPackage(src, archive);
    const outDir = path.join(tmp, 'extracted-official');
    ours.extractAll(archive, outDir);
    assert.strictEqual(fs.readFileSync(path.join(outDir, 'main.js'), 'utf8'), fs.readFileSync(path.join(src, 'main.js'), 'utf8'));
    assert.deepStrictEqual(
      [...fs.readFileSync(path.join(outDir, 'binary.bin'))],
      [...fs.readFileSync(path.join(src, 'binary.bin'))]
    );
    assert.ok(fs.existsSync(path.join(outDir, 'empty.txt')));
    assert.ok(fs.existsSync(path.join(outDir, 'empty-dir')));
  });

  await test('official extractAll works on our archive with integrity enabled', async () => {
    const src = fixture();
    const archive = path.join(tmp, 'ours-integrity.asar');
    ours.createPackageFromDirectory(src, archive, { integrity: true });
    const outDir = path.join(tmp, 'extracted-ours');
    official.extractAll(archive, outDir);
    assert.strictEqual(
      fs.readFileSync(path.join(outDir, 'src', 'deep', 'util.js'), 'utf8'),
      fs.readFileSync(path.join(src, 'src', 'deep', 'util.js'), 'utf8')
    );
  });

  await test('readManifest returns package.json fields', async () => {
    const src = fixture();
    const archive = path.join(tmp, 'manifest.asar');
    ours.createPackageFromDirectory(src, archive);
    const m = ours.readManifest(archive);
    assert.strictEqual(m.name, 'fake-app');
    assert.strictEqual(m.version, '1.2.3');
  });

  await test('unpacked files survive roundtrip (official reader)', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'rtl-asar-unpack-'));
    fs.writeFileSync(path.join(src, 'package.json'), '{"name":"u"}');
    fs.writeFileSync(path.join(src, 'native.node'), Buffer.from([9, 9, 9]));
    const archive = path.join(tmp, 'unpacked.asar');
    ours.createPackageFromDirectory(src, archive, { shouldUnpack: (rel) => rel.endsWith('.node') });
    const fromUnpackedDir = fs.readFileSync(archive + '.unpacked/native.node');
    assert.deepStrictEqual([...fromUnpackedDir], [9, 9, 9]);
    const header = ours.readHeader(archive).header;
    assert.strictEqual(header.files['native.node'].unpacked, true);
  });

  await test('full patch simulation: modify then repack keeps everything readable', async () => {
    const src = fixture();
    const original = path.join(tmp, 'app.asar');
    ours.createPackageFromDirectory(src, original);

    const work = path.join(tmp, 'work');
    ours.extractAll(original, work);
    fs.writeFileSync(path.join(work, 'rtl-universal.js'), '/* hook */');
    fs.prependFileSync ? null : null;
    const mainPath = path.join(work, 'main.js');
    fs.writeFileSync(mainPath, '/*rtl-universal-hook*/;' + fs.readFileSync(mainPath, 'utf8'));
    const patched = path.join(tmp, 'app-patched.asar');
    ours.createPackageFromDirectory(work, patched);

    assert.ok(official.extractFile(patched, 'rtl-universal.js').toString().includes('hook'));
    assert.ok(official.extractFile(patched, 'main.js').toString().startsWith('/*rtl-universal-hook*/'));
    assert.deepStrictEqual([...official.extractFile(patched, 'binary.bin')], [0, 1, 2, 3, 250, 251, 252, 253]);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    failures.forEach((f) => console.error('FAILED: ' + f.name + '\n' + f.error.stack + '\n'));
    process.exit(1);
  }
})();
