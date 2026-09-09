const { test, expect } = require('@playwright/test');
const { views, boot, show, geometry } = require('./theme-helpers.cjs');
const themes = ['calm', 'cozy', 'focus'];
const root = page => page.locator('html');
async function select(page, theme) {
  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await page.locator(`[data-sever-theme="${theme}"]`).click();
  await expect(root(page)).toHaveAttribute('data-theme', theme);
}
test('three themes: identical geometry across all eight views, same DOM, no overflow', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page);
  const first = {};
  for (const theme of themes) {
    await select(page, theme);
    for (const view of views) {
      await show(page, view);
      const before = await geometry(page);
      if (theme === 'calm') first[view] = before;
      else expect(before, `${theme}/${view}`).toEqual(first[view]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      if (view === 'ai') await page.locator('#severAiClose').click();
    }
  }
  await page.evaluate(() => {
    window.__themeTaskNode = document.querySelector('#todayTasks .task');
    window.__themeState = JSON.stringify({ tasks: SeverApp.getState().tasks, notes: SeverApp.getState().notes, habits: SeverApp.getState().habits });
  });
  await select(page, 'cozy');
  expect(await page.evaluate(() => document.querySelector('#todayTasks .task') === window.__themeTaskNode)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify({ tasks: SeverApp.getState().tasks, notes: SeverApp.getState().notes, habits: SeverApp.getState().habits }))).toBe(await page.evaluate(() => window.__themeState));
  expect(errors).toEqual([]);
});
test('live switch, radio keyboard navigation and anonymous refresh/reopen persistence', async ({ page, context }) => {
  await boot(page);
  await select(page, 'calm');
  await page.locator('[data-sever-theme="calm"]').press('ArrowRight');
  await expect(root(page)).toHaveAttribute('data-theme', 'cozy');
  await expect(page.locator('[data-sever-theme="cozy"]')).toBeFocused();
  for (const theme of themes) {
    await select(page, theme);
    await expect(page.locator(`[data-sever-theme="${theme}"]`)).toHaveAttribute('aria-checked', 'true');
    expect(await page.locator('[aria-checked="true"][data-sever-theme]').count()).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sever-anonymous-state-v1')).appearance.theme)).toBe(theme);
    await page.reload();
    await page.waitForFunction(() => window.SeverApp);
    await expect(root(page)).toHaveAttribute('data-theme', theme);
    const reopened = await context.newPage();
    await boot(reopened);
    await expect(root(reopened)).toHaveAttribute('data-theme', theme);
    await reopened.close();
  }
});
test('switching themes produces no layout-shift entries or page reload', async ({ page }) => {
  await boot(page);
  await select(page, 'calm');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__themePageIdentity = 'same-document';
    window.__themeShifts = [];
    new PerformanceObserver(list => {
      window.__themeShifts.push(...list.getEntries().map(e => e.value));
    }).observe({ type: 'layout-shift' });
  });
  for (const theme of ['cozy', 'focus', 'calm']) {
    await page.locator(`[data-sever-theme="${theme}"]`).click();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__themePageIdentity)).toBe('same-document');
  }
  expect(await page.evaluate(() => window.__themeShifts)).toEqual([]);
});
for (const theme of themes) {
  test(`${theme}: correct theme at first contentful paint with slow app bootstrap`, async ({ page }) => {
    await page.addInitScript(() => {
      window.__paintThemes = [];
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__paintThemes.push({ name: entry.name, theme: document.documentElement.dataset.theme });
      }).observe({ type: 'paint', buffered: true });
    });
    await page.route('**/app.js*', async route => { await new Promise(r => setTimeout(r, 650)); await route.continue(); });
    await boot(page, theme);
    await expect.poll(() => page.evaluate(() => window.__paintThemes.length)).toBeGreaterThan(0);
    const paints = await page.evaluate(() => window.__paintThemes);
    expect(paints.every(p => p.theme === theme)).toBe(true);
    await expect(root(page)).toHaveAttribute('data-theme', theme);
  });
  test(`${theme}: task, note, habit, timer and AI interactions remain functional`, async ({ page }) => {
    await boot(page, theme);
    await page.locator('#todayTasks .check').click();
    expect(await page.evaluate(() => SeverApp.getState().tasks[0].completed)).toBe(true);
    await page.evaluate(() => window.SeverNotes.openQuickNote());
    await page.locator('#quickNoteText').fill(`Заметка ${theme}`);
    await page.locator('#quickNoteForm .primary').click();
    expect(await page.evaluate(theme => SeverApp.getState().notes.some(n => n.title === `Заметка ${theme}`), theme)).toBe(true);
    await show(page, 'habits');
    await page.locator('#habitsView .habit-day:not(:disabled)').last().click();
    expect(await page.evaluate(() => Object.values(SeverApp.getState().checks).flat().length)).toBe(1);
    await show(page, 'timer');
    await page.locator('#timerToggle').click();
    await expect(page.locator('#timerToggle')).toContainText('Пауза');
    await select(page, themes[(themes.indexOf(theme) + 1) % 3]);
    await show(page, 'timer');
    await expect(page.locator('#timerToggle')).toContainText('Пауза');
    await page.locator('#timerToggle').click();
    await page.locator('#severAiOpen').click();
    await page.locator('#severAiInput').fill('Мой план на день');
    await expect(page.locator('#severAiInput')).toHaveValue('Мой план на день');
    await page.locator('#severAiClose').click();
    await expect(page.locator('#severAiPanel')).toBeHidden();
  });
}
test('account appearance uses existing settings projection, isolates scopes and reconciles remotely', async ({ page }) => {
  await boot(page);
  await select(page, 'cozy');
  await page.evaluate(() => { SeverApp.switchStorageScope('theme-test-user', SeverApp.freshState()); SeverApp.render(); });
  await select(page, 'focus');
  const snapshot = await page.evaluate(async () => {
    const { collectionsFor } = await import('/js/sync-core.mjs');
    return {
      theme: collectionsFor(SeverApp.getState()).settings.get('settings').data.appearance.theme,
      saved: JSON.parse(localStorage.getItem('sever-cloud-state-v1:theme-test-user')).appearance.theme,
      anonymous: JSON.parse(localStorage.getItem('sever-anonymous-state-v1')).appearance.theme
    };
  });
  expect(snapshot).toEqual({ theme: 'focus', saved: 'focus', anonymous: 'cozy' });
  await page.evaluate(async () => {
    const next = structuredClone(SeverApp.getState());
    next.appearance.theme = 'calm';
    await SeverApp.replaceState(next, { collections: ['settings'] });
  });
  await expect(root(page)).toHaveAttribute('data-theme', 'calm');
  await page.evaluate(() => { SeverApp.switchStorageScope(null); SeverApp.render(); });
  await expect(root(page)).toHaveAttribute('data-theme', 'cozy');
});
test('cached account theme survives bootstrap until account scope resolves, without exposing account data', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sever-theme', 'focus');
    localStorage.setItem('sever-theme-scope', 'sever-cloud-state-v1:theme-test-user');
    localStorage.setItem('sever-cloud-state-v1:theme-test-user', JSON.stringify({
      tasks: [], notes: [], habits: [], onboarded: true, appearance: { theme: 'focus' }
    }));
  });
  // Delay cloud initialization: the cached palette must not be replaced by anonymous Calm.
  await page.route('**/js/cloud-runtime.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await boot(page, 'calm');
  await expect(root(page)).toHaveAttribute('data-theme', 'focus');
  expect(await page.evaluate(() => SeverApp.getStorageScope())).toBe('sever-anonymous-state-v1');
  await page.evaluate(() => { SeverApp.switchStorageScope('theme-test-user'); SeverApp.render(); });
  await expect(root(page)).toHaveAttribute('data-theme', 'focus');
});
