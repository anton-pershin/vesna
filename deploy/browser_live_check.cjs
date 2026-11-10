/* Explicit live Chromium check. Requires the playwright npm package and Chromium. */
const fs = require('node:fs');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const origin = process.env.VESNA_PUBLIC_ORIGIN;
const password = process.env.VESNA_PASSWORD;
if (!origin || !password) throw new Error('VESNA_PUBLIC_ORIGIN and VESNA_PASSWORD are required');
const output = process.env.VESNA_BROWSER_RESULT || 'browser-result.json';
const screenshot = process.env.VESNA_BROWSER_SCREENSHOT;
const sampleTitle = process.env.VESNA_SAMPLE_TITLE || 'sample';

(async () => {
  const options = { headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] };
  if (process.env.CHROMIUM_EXECUTABLE) options.executablePath = process.env.CHROMIUM_EXECUTABLE;
  const browser = await playwright.chromium.launch(options);
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    const audioStatuses = new Set();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('401')) errors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.url().includes('/audio')) audioStatuses.add(response.status());
    });

    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const open = page.getByRole('button', { name: `Open ${sampleTitle}`, exact: true }).first();
    await open.waitFor();
    await open.click();
    await page.locator('#player').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#audio').duration > 0);
    const paragraphs = await page.locator('#reader > li').count();
    if (paragraphs < 2) throw new Error(`Expected multiple paragraphs, received ${paragraphs}`);

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.5);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const firstCurrent = await page.locator('#reader > li').nth(0).locator('button').getAttribute('aria-current');
    if (firstCurrent !== 'true') throw new Error('First paragraph is not current');

    await page.getByRole('button', { name: 'Next paragraph', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#reader > li:nth-child(2) button').getAttribute('aria-current') === 'true');
    await page.getByLabel('Playback speed', { exact: true }).selectOption('1.5');
    if (await page.locator('#audio').evaluate((audio) => audio.playbackRate) !== 1.5) {
      throw new Error('Playback speed did not change');
    }
    await page.getByRole('button', { name: `Play from paragraph ${paragraphs}`, exact: true }).click();
    await page.waitForFunction((index) => document.querySelector(`#reader > li:nth-child(${index}) button`).getAttribute('aria-current') === 'true', paragraphs);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByLabel('Auto-scroll to current paragraph').uncheck();
    await page.waitForTimeout(500);

    const beforeReload = await page.locator('#audio').evaluate((audio) => audio.currentTime);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: `Open ${sampleTitle}`, exact: true }).first().click();
    await page.locator('#player').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#audio').duration > 0 && document.querySelector('#audio').currentTime > 0);
    const restored = await page.locator('#audio').evaluate((audio) => ({ position: audio.currentTime, speed: audio.playbackRate }));
    if (restored.speed !== 1.5 || restored.position <= 0 || restored.position < beforeReload - 1.1) {
      throw new Error('Saved position or speed did not restore');
    }

    const cacheUrls = await page.evaluate(async () => {
      const urls = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(request.url);
      }
      return urls;
    });
    if (cacheUrls.some((url) => url.includes('/api/') || url.includes('/versions/') || url.includes('/source'))) {
      throw new Error('Private application response found in Cache Storage');
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) {
      throw new Error('Mobile viewport has horizontal overflow');
    }
    if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
    if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });

    await page.getByRole('button', { name: 'Back to library', exact: true }).click();
    await page.getByRole('button', { name: 'Open Example Domain', exact: true }).first().click();
    await page.locator('#player').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#audio').duration > 0);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.5);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const articleCurrent = await page.locator('#reader > li').first().locator('button').getAttribute('aria-current');
    if (articleCurrent !== 'true') throw new Error('Article paragraph is not current');

    const result = {
      check: 'chromium_live_ui',
      status: 'pass',
      browser: await browser.version(),
      paragraphs,
      audio_decode_and_playback: true,
      paragraph_navigation: true,
      selected_paragraph_playback: true,
      article_audio_decode_and_playback: true,
      speed_control: true,
      saved_position_and_speed_restored: true,
      cached_private_responses: 0,
      horizontal_overflow: false,
      audio_response_statuses: [...audioStatuses].sort(),
      credentials_recorded: false,
    };
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
