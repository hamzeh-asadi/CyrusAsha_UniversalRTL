const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.resolve('demo/index.html'));
  await page.waitForTimeout(600);

  const results = {};
  results.engineLoaded = await page.evaluate(() => !!window.RTLUniversal);

  // Direction of real demo elements
  results.rtlParagraph = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.msg.assistant .markdown > p')].find(x => x.textContent.includes('حتماً'));
    return p ? p.getAttribute('dir') : null;
  });
  results.englishParagraph = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.msg.assistant .markdown > p')].find(x => x.textContent.includes('Here is the same idea'));
    return p ? p.getAttribute('dir') : null;
  });
  results.codeBlock = await page.evaluate(() => {
    const pre = document.querySelector('.msg .markdown pre');
    return pre ? { dir: pre.getAttribute('dir'), marked: pre.hasAttribute('data-rtl-dir') } : null;
  });
  results.composerDir = await page.evaluate(() => document.querySelector('#composer').getAttribute('dir'));
  results.stats = await page.evaluate(() => window.RTLUniversal.stats);

  // Verify visually: computed direction in browser
  results.computedRtl = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.msg.assistant .markdown > p')].find(x => x.textContent.includes('حتماً'));
    return getComputedStyle(p).direction;
  });
  results.computedCode = await page.evaluate(() => getComputedStyle(document.querySelector('.msg .markdown pre')).direction);

  // Interaction: mode rtl
  await page.click('.seg button[data-mode="rtl"]');
  await page.waitForTimeout(300);
  results.modeRtlEnglishPara = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.msg.assistant .markdown > p')].find(x => x.textContent.includes('Here is the same idea'));
    return p.getAttribute('dir');
  });

  // Back to smart
  await page.click('.seg button[data-mode="smart"]');
  await page.waitForTimeout(300);

  // Send a Persian message
  await page.fill('#composer', 'سلام، این پیام تست فارسی است');
  await page.click('#btn-send');
  await page.waitForTimeout(800);
  results.lastUserBubbleDir = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg.user .markdown p')];
    return msgs[msgs.length - 1].getAttribute('dir');
  });
  results.lastAssistantDir = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg.assistant .markdown p')];
    return msgs[msgs.length - 1].getAttribute('dir');
  });

  // English message
  await page.fill('#composer', 'This is an English test message');
  await page.click('#btn-send');
  await page.waitForTimeout(800);
  results.lastEnglishUserDir = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg.user .markdown p')];
    return msgs[msgs.length - 1].getAttribute('dir');
  });

  // Streaming simulation keeps updating direction live
  await page.click('#btn-stream');
  await page.waitForTimeout(350);
  const midStream = await page.evaluate(() => document.querySelector('#stream-text').getAttribute('dir'));
  await page.waitForTimeout(2200);
  const finalStream = await page.evaluate(() => document.querySelector('#stream-text').getAttribute('dir'));
  results.streamMid = midStream;
  results.streamFinal = finalStream;

  // Disable restores
  await page.click('.switch .track');
  await page.waitForTimeout(250);
  results.afterDisable = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.msg.assistant .markdown > p')].find(x => x.textContent.includes('حتماً'));
    return { dir: p.getAttribute('dir'), marked: p.hasAttribute('data-rtl-dir'), styleGone: !document.getElementById('rtl-universal-style') };
  });
  await page.click('.switch .track');
  await page.waitForTimeout(400);
  results.afterReenable = await page.evaluate(() => window.RTLUniversal.stats.rtl > 0);

  // Tester
  results.testerVerdict = await page.evaluate(() => document.querySelector('#tester-verdict').textContent.trim());

  // RTL layout actually rendered? Check bubble text alignment of Persian paragraph
  results.textAlign = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.msg.assistant .markdown > p')].find(x => x.textContent.includes('حتماً'));
    return getComputedStyle(p).textAlign;
  });

  // Screenshot
  await page.screenshot({ path: '/home/user/rtl-universal/demo/screenshot.png', fullPage: false });

  // Mobile screenshot
  await page.setViewportSize({ width: 430, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/user/rtl-universal/demo/screenshot-mobile.png', fullPage: false });

  console.log(JSON.stringify(results, null, 2));
  console.log('PAGE ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();
