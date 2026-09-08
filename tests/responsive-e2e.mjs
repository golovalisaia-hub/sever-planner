import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightRoot = process.env.SEVER_PLAYWRIGHT_ROOT;
const { chromium } = playwrightRoot ? require(path.join(playwrightRoot, 'index.js')) : require('@playwright/test');
const baseURL = process.env.SEVER_E2E_URL || 'http://127.0.0.1:41740/';
const captureDir = process.env.SEVER_CAPTURE_DIR || '';
const sizes = [
  [320, 720], [360, 780], [375, 812], [390, 844], [412, 915], [430, 932],
  [1280, 720], [1366, 768], [1440, 900], [1920, 1080]
];

const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('sever-data-v2', JSON.stringify({
        version: 11,
        onboarded: true,
        challengeStart: '2026-09-06',
        challengeDays: 0,
        challengeName: '',
        tasks: [], notes: [], habits: [], checks: {}, taskMemory: [], focusSessions: [],
        profile: { name: '' },
        appearance: { theme: 'aurora', animations: 'off', reduceEffects: true },
        stats: { focusMs: 0, sessions: 0 },
        reminders: { enabled: false, time: '19:00', lastDate: '' },
        security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
      }));
    });
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.locator('#todayDashboard').waitFor({ state: 'visible' });
    const metrics = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
      return {
        docWidth: document.documentElement.scrollWidth,
        innerWidth,
        header: rect('.topbar'),
        hero: rect('.today-hero'),
        dashboard: rect('#todayDashboard'),
        tasksHead: rect('.today-list-head'),
        nav: rect('.bottom-nav'),
        sidebar: rect('.desktop-sidebar'),
        railDisplay: getComputedStyle(document.querySelector('.desktop-rail')).display,
        courseDisplay: getComputedStyle(document.querySelector('.course-card')).display,
        brand: document.querySelector('#mobileHeaderTitle')?.textContent.trim(),
        mobileItems: [...document.querySelectorAll('.bottom-nav > button')].filter(button => getComputedStyle(button).display !== 'none').length
      };
    });
    console.log(`CHECK ${width}x${height} tasksY=${Math.round(metrics.tasksHead.top)} hero=${Math.round(metrics.hero.height)} metrics=${Math.round(metrics.dashboard.height)} doc=${metrics.docWidth}`);
    assert.equal(metrics.docWidth, width, `${width}x${height}: horizontal overflow`);
    assert.equal(metrics.courseDisplay, 'none', `${width}x${height}: duplicate progress card visible`);
    assert.equal(metrics.brand, 'SEVER', `${width}x${height}: mobile brand changed`);
    if (width <= 900) {
      assert.equal(metrics.mobileItems, 5, `${width}x${height}: bottom nav must contain five items`);
      assert.ok(metrics.header.height >= 56 && metrics.header.height <= 80, `${width}x${height}: header is not compact`);
      assert.ok(metrics.hero.height >= 140 && metrics.hero.height <= 170, `${width}x${height}: hero too tall`);
      assert.ok(metrics.dashboard.height <= (width <= 350 ? 185 : 100), `${width}x${height}: metrics too tall`);
      assert.ok(metrics.tasksHead.top < (width <= 350 ? 520 : 440), `${width}x${height}: tasks start below the first-screen target`);
      assert.ok(metrics.nav.bottom <= height + 1 && metrics.nav.height <= 86, `${width}x${height}: bottom navigation geometry invalid`);
      const assertSingleView = async expected => {
        const views = await page.evaluate(() => [...document.querySelectorAll('.view')].map(view => ({ id: view.id, display: getComputedStyle(view).display })));
        assert.deepEqual(views.filter(view => view.display !== 'none').map(view => view.id), [expected], `${width}x${height}: exactly one view must be visible`);
        assert.equal(views.find(view => view.id === 'todayView')?.display, expected === 'todayView' ? 'grid' : 'none', `${width}x${height}: Home must not remain under ${expected}`);
      };
      await assertSingleView('todayView');
      await page.locator('.bottom-nav button[data-view="calendar"]').click();
      await assertSingleView('calendarView');
      await page.locator('.bottom-nav button[data-view="notes"]').click();
      await assertSingleView('notesView');
      await page.locator('.bottom-nav button[data-view="today"]').click();
      await page.locator('#todayFocusWidget').click();
      await assertSingleView('timerView');
      await page.locator('#mobileNavMore').click();
      await page.locator('#openSettingsMenu').click();
      await assertSingleView('settingsView');

    } else {
      assert.ok(metrics.sidebar.width >= 170 && metrics.sidebar.width <= 195, `${width}x${height}: desktop sidebar width invalid`);
      assert.ok(metrics.hero.height <= 125, `${width}x${height}: desktop hero too tall`);
      assert.ok(metrics.tasksHead.top < 430, `${width}x${height}: desktop tasks start too low`);
      assert.equal(metrics.railDisplay, width >= 1200 ? 'grid' : 'none', `${width}x${height}: context rail breakpoint invalid`);
    }
    if (captureDir) {
      fs.mkdirSync(captureDir, { recursive: true });
      await page.screenshot({ path: path.join(captureDir, `sever-${width}x${height}.png`) });
    }
    console.log(`PASS ${width}x${height}`);
    await context.close();
  }
} finally {
  await browser.close();
}
