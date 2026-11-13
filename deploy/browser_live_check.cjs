/* Explicit live Chromium check for the M4 interface. Requires Playwright and Chromium. */
const fs = require('node:fs');
const path = require('node:path');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const origin = process.env.VESNA_PUBLIC_ORIGIN;
const password = process.env.VESNA_PASSWORD;
if (!origin || !password) throw new Error('VESNA_PUBLIC_ORIGIN and VESNA_PASSWORD are required');
const output = process.env.VESNA_BROWSER_RESULT || 'browser-result.json';
const screenshotDir = process.env.VESNA_BROWSER_SCREENSHOT_DIR;
const sampleTitle = process.env.VESNA_SAMPLE_TITLE || 'sample';
const deletionTitle = process.env.VESNA_DELETE_TITLE || `m4-delete-check-${Date.now()}`;
const executablePath = process.env.CHROMIUM_EXECUTABLE;

function check(value, message) {
  if (!value) throw new Error(message);
}

(async () => {
  if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
  const options = { headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] };
  if (executablePath) options.executablePath = executablePath;
  const browser = await playwright.chromium.launch(options);
  const evidence = {
    check: 'chromium_live_m4_ui',
    status: 'pass',
    browser: null,
    viewports: [],
    screens: {},
    playback: {},
    deletion: {},
    accessibility: {},
    cached_private_responses: 0,
    audio_response_statuses: [],
    credentials_recorded: false,
  };
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    const audioStatuses = new Set();
    let audioRequestCount = 0;
    page.on('request', (request) => {
      if (request.url().includes('/audio')) audioRequestCount += 1;
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('401')) errors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.url().includes('/audio')) audioStatuses.add(response.status());
    });
    evidence.browser = await browser.version();

    async function capture(name) {
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: false });
    }

    async function libraryItems() {
      const response = await context.request.get(`${origin}/api/items`);
      check(response.status() === 200, `Library API returned ${response.status()}`);
      return (await response.json()).items;
    }

    async function openItem(title) {
      await page.getByRole('button', { name: `Open ${title}`, exact: true }).first().click();
      await page.locator('#item-view').waitFor({ state: 'visible' });
    }

    async function waitForRealAudio() {
      await page.locator('#item-state').filter({ hasText: 'Ready to listen' }).waitFor({ timeout: 120000 });
      await page.locator('#player').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('#audio').duration > 0, null, { timeout: 30000 });
      await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
    }

    async function assertLayout(label) {
      const metrics = await page.evaluate(() => {
        const player = document.querySelector('#player');
        const playerRect = player.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          viewportHeight: document.documentElement.clientHeight,
          playerVisible: !player.hidden,
          playerBottom: playerRect.bottom,
        };
      });
      check(!metrics.overflow, `${label}: horizontal page overflow ${JSON.stringify(metrics)}`);
      if (metrics.playerVisible) {
        check(Math.abs(metrics.playerBottom - metrics.viewportHeight) <= 1.5, `${label}: playback bar does not meet the viewport bottom ${JSON.stringify(metrics)}`);
      }
      evidence.viewports.push({ label, horizontal_overflow: false, playback_bar_at_bottom: metrics.playerVisible || undefined });
    }

    async function assertTouchTargets() {
      const selectors = [
        '#add-content', '#refresh', '#previous', '#play-pause', '#next', '#seekbar',
        '#source-panel summary', '#playback-settings summary', '#item-menu summary', '.paragraph-button',
        '#speed', '.check-control', '#delete-item', '#cancel-delete', '#confirm-delete',
      ];
      for (const selector of selectors) {
        const control = page.locator(selector).first();
        if (!(await control.isVisible())) continue;
        const box = await control.boundingBox();
        check(box && box.width >= 44 && box.height >= 44, `${selector}: visible touch target is smaller than 44px`);
      }
      evidence.accessibility.primary_touch_targets = 'at least 44 CSS px';
    }

    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('#library-view').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: `Open ${sampleTitle}`, exact: true }).first().waitFor();
    check(await page.locator('#input-view').isHidden(), 'Input screen is visible with the library');
    check(await page.locator('#item-view').isHidden(), 'Reader is visible with the library');
    await capture('01-library-mobile');
    await assertTouchTargets();
    evidence.screens.focused_library = true;

    const initialIds = new Set((await libraryItems()).map((item) => item.id));

    await page.locator('#add-content').click();
    await page.locator('#input-view').waitFor({ state: 'visible' });
    await page.locator('#article-panel').waitFor({ state: 'visible' });
    check(await page.locator('#markdown-panel').isHidden(), 'Both input forms are visible together');
    await capture('02-add-article-mobile');
    await page.locator('#article-url').fill('https://example.com');
    await page.locator('#submit-article').click();
    await page.locator('#item-view').waitFor({ state: 'visible' });
    await page.locator('#close-item').click();
    const afterArticle = await libraryItems();
    const articleItem = afterArticle.find((item) => !initialIds.has(item.id));
    check(articleItem, 'Submitted article did not create exactly one new item');
    const articleOpen = page.locator(`[data-item-id="${articleItem.id}"][data-library-action="open"]`);
    await articleOpen.waitFor({ state: 'visible' });
    await articleOpen.focus();
    await page.waitForFunction((itemId) => {
      const entry = document.querySelector(`[data-item-id="${itemId}"][data-library-action="open"]`);
      return entry?.textContent.includes('Ready to listen');
    }, articleItem.id, { timeout: 120000 });
    check(await page.evaluate((itemId) => document.activeElement?.dataset.itemId === itemId, articleItem.id), 'Polling removed focus from the preparing library item');
    evidence.accessibility.polling_focus_preserved = true;
    await articleOpen.click();
    await waitForRealAudio();
    await page.locator('#play-pause').click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.2);
    await page.locator('#play-pause').click();
    evidence.playback.new_article_audio = true;
    evidence.screens.article_submission = true;

    await page.locator('#close-item').click();
    await page.locator('#add-content').click();
    await page.locator('#select-markdown').click();
    await page.locator('#markdown-panel').waitFor({ state: 'visible' });
    check(await page.locator('#article-panel').isHidden(), 'Article form remained visible with Markdown form');
    await page.locator('#markdown-file').setInputFiles({
      name: `${deletionTitle}.markdown`,
      mimeType: 'text/markdown',
      buffer: Buffer.from('Disposable deletion item.\n\nThis item verifies safe deletion.\n\nIt contains three short paragraphs.'),
    });
    check((await page.locator('#selected-file').textContent()).includes(`${deletionTitle}.markdown`), 'Selected filename is not shown');
    await capture('03-add-markdown-mobile');
    await page.locator('#upload-markdown').click();
    await page.locator('#item-view').waitFor({ state: 'visible' });
    await page.locator('#item-title').filter({ hasText: deletionTitle }).waitFor();
    await page.locator('#source-panel summary').click();
    await page.locator('#markdown-source').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#source-text').textContent.includes('Disposable deletion item'));
    await page.locator('#reader').evaluate((reader) => { reader.style.minHeight = '1200px'; });
    await page.locator('#main').evaluate((main) => { main.scrollTop = 40; });
    const sourceScrollBefore = await page.locator('#main').evaluate((main) => main.scrollTop);
    check(sourceScrollBefore === 40, 'The source-scroll fixture did not produce a nonzero reading position');
    await waitForRealAudio();
    check(await page.locator('#source-panel').evaluate((panel) => panel.open), 'Preparation refresh closed the source panel');
    check(await page.locator('#main').evaluate((main) => main.scrollTop) === sourceScrollBefore, 'Preparation refresh changed the reading position');
    evidence.screens.refresh_preserved_source_and_scroll = true;
    await page.locator('#source-panel summary').click();
    const afterMarkdown = await libraryItems();
    const markdownItem = afterMarkdown.find((item) => !initialIds.has(item.id) && item.id !== articleItem.id);
    check(markdownItem, 'Submitted Markdown did not create exactly one new item');
    evidence.screens.markdown_submission = true;

    await page.locator('#close-item').click();
    await openItem(sampleTitle);
    await waitForRealAudio();
    const paragraphs = await page.locator('#reader > li').count();
    check(paragraphs >= 2, `Expected multiple paragraphs, received ${paragraphs}`);
    check(await page.locator('#audio').evaluate((audio) => audio.controls) === false, 'Native audio controls are still enabled');
    check(await page.locator('#play-pause').isVisible(), 'Custom play/pause control is unavailable');
    check(await page.locator('#position').getAttribute('aria-live') === 'off', 'Playback time can be announced continuously');
    evidence.playback.single_visible_control_set = true;
    evidence.accessibility.non_live_time = true;

    await page.locator('#play-pause').click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.5);
    check(await page.locator('#play-pause').getAttribute('aria-label') === 'Pause', 'Play/pause did not change to Pause');
    await page.locator('#play-pause').click();
    check(await page.locator('#play-pause').getAttribute('aria-label') === 'Play', 'Play/pause did not change to Play');
    evidence.playback.play_pause = true;

    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('#reader > li:nth-child(2) button').getAttribute('aria-current') === 'true', null, { timeout: 1000 });
    await page.locator('#previous').click();
    await page.waitForFunction(() => document.querySelector('#reader > li:first-child button').getAttribute('aria-current') === 'true', null, { timeout: 1000 });
    evidence.playback.highlight_within_one_second = true;
    await page.locator('#playback-settings summary').click();
    await assertTouchTargets();
    await page.getByLabel('Playback speed', { exact: true }).selectOption('1.5');
    check(await page.locator('#audio').evaluate((audio) => audio.playbackRate) === 1.5, 'Playback speed did not change');
    await page.locator('#seekbar').evaluate((slider) => {
      slider.value = '2';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const position = document.querySelector('#audio').currentTime;
      return position >= 1.5 && position <= 2.75;
    });
    evidence.playback.direct_seek = true;
    await page.getByLabel('Follow the current paragraph').check();
    await page.locator('#main').evaluate((main) => { main.scrollTop = 0; });
    await page.locator(`#reader > li:nth-child(${paragraphs}) button`).evaluate((button) => button.click());
    await page.waitForFunction((index) => document.querySelector(`#reader > li:nth-child(${index}) button`).getAttribute('aria-current') === 'true', paragraphs, { timeout: 1000 });
    await page.waitForFunction(() => document.querySelector('#main').scrollTop > 0, null, { timeout: 1000 });
    evidence.playback.actual_auto_scroll = true;
    await page.locator('#play-pause').click();
    await page.getByLabel('Follow the current paragraph').uncheck();
    evidence.playback.paragraph_navigation = true;
    evidence.playback.selected_paragraph = true;
    evidence.playback.speed_and_autoscroll = true;

    const beforeReload = await page.locator('#audio').evaluate((audio) => audio.currentTime);
    await page.reload({ waitUntil: 'networkidle' });
    await openItem(sampleTitle);
    await waitForRealAudio();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0);
    const restored = await page.locator('#audio').evaluate((audio) => ({ position: audio.currentTime, speed: audio.playbackRate }));
    check(restored.speed === 1.5 && restored.position > 0 && restored.position >= beforeReload - 1.1, 'Saved position or speed did not restore');
    evidence.playback.saved_position_and_speed = true;

    await page.locator('#source-panel summary').click();
    await page.locator('#markdown-source').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#source-text').textContent.includes('Vesna'));
    check((await page.locator('#source-detail').textContent()).includes('sample'), 'Full uploaded filename is not available');
    const originalSourceDetail = await page.locator('#source-detail').textContent();
    await page.locator('#source-detail').evaluate((source) => {
      source.textContent = `Uploaded file: ${'very-long-filename-segment-'.repeat(15)}.markdown`;
    });
    await assertLayout('long-filename-source');
    await page.locator('#source-detail').evaluate((source, value) => { source.textContent = value; }, originalSourceDetail);
    await capture('04-reader-source-mobile');
    evidence.screens.source_on_demand = true;
    evidence.accessibility.long_filename_source = true;
    await page.locator('#source-panel summary').click();

    const beforeScrollAudioRequests = audioRequestCount;
    for (const position of ['top', 'middle', 'bottom']) {
      await page.locator('#main').evaluate((main, value) => {
        if (value === 'top') main.scrollTop = 0;
        if (value === 'middle') main.scrollTop = main.scrollHeight / 2;
        if (value === 'bottom') main.scrollTop = main.scrollHeight;
      }, position);
      await assertLayout(`mobile-${position}`);
    }
    await page.locator('#reader > li').last().evaluate((entry) => entry.scrollIntoView({ block: 'end' }));
    const finalGeometry = await page.evaluate(() => ({
      paragraphBottom: document.querySelector('#reader > li:last-child').getBoundingClientRect().bottom,
      playerTop: document.querySelector('#player').getBoundingClientRect().top,
    }));
    check(finalGeometry.paragraphBottom <= finalGeometry.playerTop + 1, 'Playback bar covers the final paragraph');
    evidence.playback.final_paragraph_not_covered = true;
    check(audioRequestCount === beforeScrollAudioRequests, 'Scrolling produced additional audio requests');
    evidence.playback.no_audio_requests_from_scrolling = true;
    await page.locator('#main').evaluate((main) => { main.scrollTop = 0; });
    await capture('05-reader-mobile');
    await assertTouchTargets();

    const cacheUrls = await page.evaluate(async () => {
      const urls = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(request.url);
      }
      return urls;
    });
    check(!cacheUrls.some((url) => url.includes('/api/') || url.includes('/versions/') || url.includes('/source')), 'Private response found in Cache Storage');
    evidence.cached_private_responses = 0;

    await page.locator('#close-item').click();
    await openItem('Example Domain');
    await waitForRealAudio();
    await page.locator('#seekbar').evaluate((slider) => {
      slider.value = '4';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('#audio').currentTime >= 3.5);
    await page.locator('#play-pause').click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 4);
    await page.locator('#close-item').click();
    await openItem(sampleTitle);
    await waitForRealAudio();
    await page.locator('#seekbar').evaluate((slider) => {
      slider.value = '0';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#play-pause').click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.3);
    await page.locator('#close-item').click();
    await openItem('Example Domain');
    await waitForRealAudio();
    await page.locator('#play-pause').click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 5.5);
    check(await page.locator('#reader > li:first-child button').getAttribute('aria-current') === 'true', 'Restored article lost its highlight after another item played');
    check(await page.locator('#reader > li:first-child .current-marker').isVisible(), 'Restored article current marker disappeared after another item played');
    evidence.playback.article_to_item_to_article_highlight = true;

    await page.locator('#close-item').click();
    await openItem(deletionTitle);
    await waitForRealAudio();
    await page.locator('#play-pause').click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.3);
    await page.locator('#item-menu summary').click();
    await assertTouchTargets();
    await page.locator('#delete-item').click();
    await page.locator('#delete-dialog').waitFor({ state: 'visible' });
    check((await page.locator('#delete-item-name').textContent()).includes(deletionTitle), 'Deletion dialog does not name the item');
    await assertTouchTargets();
    await capture('06-delete-confirmation-mobile');
    await page.locator('#cancel-delete').click();
    check(await page.locator('#delete-dialog').isHidden(), 'Cancel did not close deletion dialog');
    check(await page.locator('#item-title').textContent() === deletionTitle, 'Cancellation changed the item');
    check(await page.locator('#audio').evaluate((audio) => !audio.paused), 'Cancellation stopped active playback');
    check(await page.evaluate(() => document.activeElement === document.querySelector('#item-menu summary')), 'Cancel did not restore focus to the item-menu summary');
    check(await page.evaluate((itemId) => localStorage.getItem(`vesna.prepared-playback-state:${encodeURIComponent(itemId)}:${encodeURIComponent(document.querySelector('#audio').src.split('/').at(-2))}`) !== null, markdownItem.id), 'Cancellation cleared saved playback state');
    evidence.deletion.cancel_preserved_item = true;
    evidence.deletion.cancel_preserved_playback_and_focus = true;

    await page.locator('#item-menu summary').click();
    await page.locator('#delete-item').click();
    await page.keyboard.press('Escape');
    await page.locator('#delete-dialog').waitFor({ state: 'hidden' });
    check(await page.locator('#audio').evaluate((audio) => !audio.paused), 'Escape stopped active playback');
    check(await page.evaluate(() => document.activeElement === document.querySelector('#item-menu summary')), 'Escape did not restore focus to the item-menu summary');
    evidence.deletion.escape_preserved_playback_and_focus = true;

    const stalePayloads = await Promise.all([
      context.request.get(`${origin}/api/items/${markdownItem.id}/versions/${markdownItem.version}/text`),
      context.request.get(`${origin}/api/items/${markdownItem.id}/versions/${markdownItem.version}/timings`),
      context.request.get(`${origin}/api/items/${markdownItem.id}/source`),
    ]);
    check(stalePayloads.every((response) => response.status() === 200), 'Could not capture valid stale-response fixtures');
    const [textPayload, timingsPayload, sourcePayload] = await Promise.all(stalePayloads.map((response) => response.text()));
    const releaseStaleResponses = [];
    await page.route(`**/api/items/${markdownItem.id}/versions/${markdownItem.version}/text`, (route) => {
      releaseStaleResponses.push(() => route.fulfill({ status: 200, contentType: 'application/json', body: textPayload }));
    });
    await page.route(`**/api/items/${markdownItem.id}/versions/${markdownItem.version}/timings`, (route) => {
      releaseStaleResponses.push(() => route.fulfill({ status: 200, contentType: 'application/json', body: timingsPayload }));
    });
    await page.route(`**/api/items/${markdownItem.id}/source`, (route) => {
      releaseStaleResponses.push(() => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: sourcePayload }));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await openItem(deletionTitle);
    await page.locator('#item-title').filter({ hasText: deletionTitle }).waitFor();
    await page.locator('#source-panel summary').click();
    await page.locator('#item-menu summary').click();
    await page.locator('#delete-item').click();
    await page.locator('#confirm-delete').click();
    await page.locator('#library-view').waitFor({ state: 'visible', timeout: 120000 });
    check(releaseStaleResponses.length === 3, 'Source and prepared responses were not both held');
    for (const release of releaseStaleResponses) await release();
    await page.waitForLoadState('networkidle');
    check(await page.locator('#source-text').textContent() === '', 'A stale source response restored deleted content');
    check(await page.locator('#audio').evaluate((audio) => !audio.getAttribute('src')), 'A stale prepared response restored deleted audio');
    evidence.deletion.stale_source_and_prepared_responses_ignored = true;
    check(await page.getByRole('button', { name: `Open ${deletionTitle}`, exact: true }).count() === 0, 'Deleted item reappeared in the library');
    check(await page.locator('#audio').evaluate((audio) => audio.paused && !audio.getAttribute('src')), 'Deletion did not stop and unload playback');
    evidence.deletion.playback_stopped = true;
    const cleanup = await page.evaluate((itemId) => {
      const prefix = `vesna.prepared-playback-state:${encodeURIComponent(itemId)}:`;
      const remaining = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key.startsWith(prefix)) remaining.push(key);
      }
      return remaining.length;
    }, markdownItem.id);
    check(cleanup === 0, 'Deleted item playback state remains in local storage');
    check((await context.request.get(`${origin}/api/items/${markdownItem.id}`)).status() === 404, 'Deleted item detail remains accessible');
    check((await context.request.get(`${origin}/api/items/${markdownItem.id}/versions/${markdownItem.version}/audio`)).status() === 404, 'Deleted audio remains accessible');
    evidence.deletion.confirm_removed_item = true;
    evidence.deletion.local_state_cleared = true;
    evidence.deletion.server_artifacts_denied = true;

    await openItem('Example Domain');
    await waitForRealAudio();
    await page.evaluate(() => {
      const longTitle = 'An unusually long article title designed to verify wrapping and layout stability across every supported viewport without causing horizontal page overflow';
      const longUrl = 'https://example.com/' + 'very-long-path-segment-'.repeat(12);
      document.querySelector('#item-title').textContent = longTitle;
      document.querySelector('#source-detail').textContent = longUrl;
      document.querySelector('#article-link').textContent = longUrl;
      document.querySelector('#article-link').href = longUrl;
      document.querySelector('#item-error').textContent = `Preparation failed: ${'safe detailed error message '.repeat(12)}`;
      document.querySelector('#item-error').hidden = false;
      document.querySelector('#reader > li:first-child button').textContent = 'Long paragraph fixture. '.repeat(30);
    });
    await page.locator('#source-panel summary').click();
    await assertLayout('long-content-fixtures');
    await page.locator('#source-panel summary').click();
    evidence.accessibility.long_content_fixtures = true;
    await page.setViewportSize({ width: 1280, height: 800 });
    await assertLayout('desktop');
    await capture('07-reader-desktop');
    await page.setViewportSize({ width: 320, height: 700 });
    await assertLayout('small-phone');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await assertLayout('text-scaling-200-percent');
    const signOutBox = await page.locator('#sign-out').boundingBox();
    check(signOutBox && signOutBox.x >= 0 && signOutBox.x + signOutBox.width <= 320, 'Sign-out is clipped at 200% text scaling');
    evidence.accessibility.sign_out_visible_at_200_percent = true;
    await capture('08-reader-small-phone-200-text');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    evidence.accessibility.reduced_motion = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'auto');
    check(evidence.accessibility.reduced_motion, 'Reduced-motion preference is not respected');
    evidence.accessibility.horizontal_overflow = false;
    evidence.accessibility.text_scaling_200_percent = true;

    await page.locator('#sign-out').click();
    await page.locator('#auth-view').waitFor({ state: 'visible' });
    check(await page.locator('#application-view').isHidden(), 'Private application remains visible after sign-out');
    check(await page.evaluate(() => document.activeElement?.id === 'password'), 'Sign-out did not move focus to the password field');
    check((await context.request.get(`${origin}/api/items`)).status() === 401, 'Sign-out did not invalidate the session');
    evidence.screens.sign_out_clearing = true;

    evidence.audio_response_statuses = [...audioStatuses].sort();
    check(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
