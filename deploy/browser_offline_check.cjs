/* Explicit real-Chromium check for issue #13. Requires a prepared sample item. */
const fs = require('node:fs');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const origin = process.env.VESNA_PUBLIC_ORIGIN;
const password = process.env.VESNA_PASSWORD;
if (!origin || !password) throw new Error('VESNA_PUBLIC_ORIGIN and VESNA_PASSWORD are required');
const title = process.env.VESNA_SAMPLE_TITLE || 'offline-sample';
const profile = process.env.VESNA_OFFLINE_PROFILE || '/tmp/vesna-offline-browser-profile';
const output = process.env.VESNA_OFFLINE_RESULT || '/tmp/vesna-offline-browser-result.json';
const executablePath = process.env.CHROMIUM_EXECUTABLE;

function check(value, message) {
  if (!value) throw new Error(message);
}

(async () => {
  fs.rmSync(profile, { recursive: true, force: true });
  const result = {
    check: 'chromium_real_item_offline', status: 'pass', browser: null,
    online_download: {}, offline_restart: {}, offline_second_restart: {}, online_after_removal: {},
    credentials_recorded: false,
  };
  const options = {
    headless: true,
    viewport: { width: 390, height: 844 },
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    serviceWorkers: 'allow',
  };
  if (executablePath) options.executablePath = executablePath;
  let context;
  let page;
  const failures = [];
  const browserErrors = [];
  try {
    async function launch(offline = false) {
      context = await playwright.chromium.launchPersistentContext(profile, { ...options, offline });
      result.browser = context.browser()?.version() || 'Chromium';
      const page = context.pages()[0] ?? await context.newPage();
      page.on('pageerror', (error) => browserErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text());
      });
      page.on('requestfailed', (request) => {
        const path = new URL(request.url()).pathname;
        failures.push({ offline, path, error: request.failure()?.errorText });
      });
      return page;
    }

    async function openSample(page) {
      await page.getByRole('button', { name: `Open ${title}`, exact: true }).click();
      await page.locator('#item-view').waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const audio = document.querySelector('#audio');
        return Number.isFinite(audio.duration) && audio.duration > 0;
      }, null, { timeout: 30000 });
    }

    async function seekAndSave(page, position, speed) {
      await page.locator('#playback-settings').evaluate((details) => { details.open = true; });
      await page.locator('#speed').selectOption(String(speed));
      await page.locator('#seekbar').evaluate((slider, target) => {
        slider.value = String(target);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }, position);
      await page.waitForFunction((target) => {
        const audio = document.querySelector('#audio');
        return Math.abs(audio.currentTime - target) < 0.15;
      }, position, { timeout: 10000 });
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await page.waitForTimeout(150);
    }

    page = await launch(false);
    await page.goto(origin, { waitUntil: 'networkidle', timeout: 60000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (await page.locator('#auth-view').isVisible()) {
      await page.locator('#password').fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await page.locator('#library-view').waitFor({ state: 'visible' });
    await openSample(page);
    await page.locator('#download-item').waitFor({ state: 'visible' });
    await page.locator('#download-item').click();
    await page.waitForFunction(() => (
      document.querySelector('#download-status').textContent.includes('Available offline')
    ), null, { timeout: 60000 });
    const cacheEvidence = await page.evaluate(async () => {
      const names = await caches.keys();
      let preparedResources = 0;
      let forbiddenResponses = 0;
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const path = new URL(request.url).pathname;
          const isPrepared = /\/versions\/[^/]+\/(manifest|text|timings|audio)$/.test(path);
          if (isPrepared) preparedResources += 1;
          if (path.startsWith('/api/') && !isPrepared) forbiddenResponses += 1;
        }
      }
      return { preparedResources, forbiddenResponses, cacheCount: names.length };
    });
    check(cacheEvidence.preparedResources === 4, 'Expected exactly four explicit prepared resources');
    check(cacheEvidence.forbiddenResponses === 0, 'An unrelated private response entered Cache Storage');
    result.online_download = { ...cacheEvidence, offlineReady: true };
    await seekAndSave(page, 0, 1.25);
    await context.close();
    context = null;

    page = await launch(true);
    await page.goto(origin, { waitUntil: 'load', timeout: 30000 });
    await page.locator('#library-view').waitFor({ state: 'visible' });
    check(!(await page.locator('#auth-view').isVisible()), 'Offline startup requested a password');
    check(await page.locator('#app-status').textContent().then((text) => text.includes('Offline mode')), 'Offline status is missing');
    check(!(await page.locator('#add-content').isVisible()), 'Network-only input is visible offline');
    await openSample(page);
    check(await page.locator('#speed').inputValue() === '1.25', 'Saved online speed did not restore offline');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await seekAndSave(page, 1, 1.5);
    result.offline_restart = {
      libraryOpened: true,
      readerOpened: true,
      playbackWorked: true,
      speedRestored: true,
      paragraphs: await page.locator('#reader li').count(),
    };
    await context.close();
    context = null;

    page = await launch(true);
    await page.goto(origin, { waitUntil: 'load', timeout: 30000 });
    await page.locator('#library-view').waitFor({ state: 'visible' });
    await openSample(page);
    check(await page.locator('#speed').inputValue() === '1.5', 'Offline speed did not survive a second restart');
    check(await page.locator('#audio').evaluate((audio) => Math.abs(audio.currentTime - 1) < 0.2), 'Offline position did not survive a second restart');
    result.offline_second_restart = { speedRestored: true, positionRestored: true };
    await page.locator('#remove-download').click();
    await page.locator('#library-view').waitFor({ state: 'visible' });
    check(await page.locator('#library-empty').isVisible(), 'Offline library remained populated after removal');
    await context.close();
    context = null;

    page = await launch(false);
    await page.goto(origin, { waitUntil: 'networkidle', timeout: 60000 });
    if (await page.locator('#auth-view').isVisible()) {
      await page.locator('#password').fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await page.locator('#library-view').waitFor({ state: 'visible' });
    check(await page.getByRole('button', { name: `Open ${title}`, exact: true }).count() === 1, 'Removal deleted the server item');
    result.online_after_removal = { serverItemPreserved: true };
    await context.close();
    context = null;

    result.failed_prepared_requests = failures.filter((entry) => entry.offline && entry.path.includes('/versions/'));
    check(result.failed_prepared_requests.length === 0, 'A prepared request failed offline');
    result.failed_request_paths = [...new Set(failures.map((entry) => entry.path))].filter((path) => !path.includes('/versions/'));
  } catch (error) {
    result.status = 'fail';
    result.error = error.message;
    result.error_stack = error.stack;
    result.browser_errors = browserErrors;
    if (page) {
      result.debug = {
        appError: await page.locator('#app-error').textContent().catch(() => ''),
        downloadStatus: await page.locator('#download-status').textContent().catch(() => ''),
        url: page.url(),
      };
    }
    throw error;
  } finally {
    if (context) await context.close();
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  }
})().catch(() => { process.exitCode = 1; });
