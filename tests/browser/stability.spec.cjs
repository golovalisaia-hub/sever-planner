const { test, expect } = require('@playwright/test');
test.beforeEach(async ({ page }) => {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({ tasks: [], notes: [], habits: [], folders: [], onboarded: true, appearance: { theme: 'black', animations: 'off', reduceEffects: true } })));
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes);
});
test('old task draft cannot be submitted into a different account', async ({ page }) => {
  await page.evaluate(() => { window.SeverApp.switchView('today'); document.querySelector('#globalAddBtn').click(); document.querySelector('#quickAddTask').click(); });
  await page.locator('#taskTitle').fill('Private draft A');
  await page.evaluate(() => window.SeverApp.switchStorageScope('draft-b', window.SeverApp.freshState()));
  await page.locator('#taskForm').evaluate(form => form.requestSubmit());
  await expect(page.locator('#taskTitle')).toHaveValue('Private draft A');
  await expect(page.locator('.scope-conflict')).toBeVisible();
  expect(await page.evaluate(() => window.SeverApp.getState().tasks.length)).toBe(0);
});
async function only(page, view) {
  await expect.poll(() => page.locator('.view').evaluateAll(views => views.filter(v => getComputedStyle(v).display !== 'none').map(v => v.id))).toEqual([view + 'View']);
}
test('anonymous storage stays separate and legacy is not an eternal fallback', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const app = window.SeverApp;
    localStorage.setItem('sever-data-v2', JSON.stringify({ ...app.freshState(), tasks: [{ id: 'legacy', title: 'Legacy' }] }));
    app.getState().tasks.push({ id: 'anonymous', title: 'Анализ крови G' });
    await app.persist();
    app.switchStorageScope('test-a', app.freshState());
    const account = app.getState().tasks.length;
    const candidate = app.getAnonymousImportCandidate();
    app.switchStorageScope(null, app.freshState());
    const anonymous = app.getState().tasks.map(t => t.id);
    app.getState().tasks = []; await app.persist();
    return { account, candidate: candidate.tasks.map(t => t.id), anonymous, remaining: app.getAnonymousImportCandidate().tasks.length, legacyPreserved: localStorage.getItem('sever-data-v2') !== null };
  });
  expect(result).toEqual({ account: 0, candidate: ['anonymous'], anonymous: ['anonymous'], remaining: 0, legacyPreserved: true });
});
test('running timer cannot write a session into another storage scope', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => window.SeverApp.startTimer({ durationMinutes: 1 }));
  await page.clock.runFor(1000);
  await page.evaluate(() => window.SeverApp.switchStorageScope('test-b', window.SeverApp.freshState()));
  await page.clock.runFor(61000);
  expect(await page.evaluate(() => window.SeverApp.getState().stats.sessions)).toBe(0);
  expect(await page.evaluate(() => window.SeverApp.getContext().activeTimerId)).toBe('');
});
test('navigation, SVG metrics, AI geometry, creation and note capture', async ({ page }, info) => {
  const phone = info.project.name !== 'desktop';
  await only(page, 'today');
  if (phone) {
    const metrics = await page.locator('#todayDashboard .metric-icon').evaluateAll(items => items.map(el => ({
      svg: el.querySelectorAll('svg').length,
      vectorParts: el.querySelectorAll('path,circle,rect,line,polyline,polygon').length
    })));
    expect(metrics).toHaveLength(4);
    for (const metric of metrics) { expect(metric.svg).toBe(1); expect(metric.vectorParts).toBeGreaterThan(0); }

    const homeMode = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      dashboardDisplay: getComputedStyle(document.querySelector('#todayDashboard')).display,
      utilitiesDisplay: getComputedStyle(document.querySelector('#todayView .today-utilities')).display,
      homeHeight: document.querySelector('#sever2HomeCore').getBoundingClientRect().height,
      createHeight: document.querySelector('#sever2HomeCore [data-home-action="create"]').getBoundingClientRect().height
    }));
    expect(homeMode.theme).toBe('black');
    expect(homeMode.dashboardDisplay).toBe('none');
    expect(homeMode.utilitiesDisplay).toBe('none');
    expect(homeMode.homeHeight).toBeGreaterThan(150);
    expect(homeMode.createHeight).toBeGreaterThanOrEqual(44);

    const geometry = await page.evaluate(() => {
      const ai = document.querySelector('#severAiOpen').getBoundingClientRect(), nav = document.querySelector('.bottom-nav').getBoundingClientRect(), create = document.querySelector('.mobile-create .nav-icon').getBoundingClientRect();
      return { ai: ai.toJSON(), nav: nav.toJSON(), create: create.toJSON(), width: innerWidth, height: innerHeight };
    });
    expect(geometry.ai.width).toBeGreaterThanOrEqual(44); expect(geometry.ai.width).toBeLessThanOrEqual(56);
    expect(geometry.ai.height).toBe(geometry.ai.width); expect(geometry.ai.bottom).toBeLessThanOrEqual(geometry.nav.top - 16);
    expect(geometry.ai.right).toBeLessThanOrEqual(geometry.width); expect(geometry.ai.top).toBeGreaterThanOrEqual(0);
    expect(Math.abs(geometry.create.width - geometry.create.height)).toBeLessThan(1);
    await page.locator('#mobileCreateBtn').click(); await expect(page.locator('#quickAddDialog')).toBeVisible();
    await page.locator('#quickCaptureInput').fill('Проверка создания'); await page.locator('#quickCaptureForm button[type=submit]').click();
    await expect(page.locator('#todayTasks')).toContainText('Проверка создания');

    await page.locator('.bottom-nav [data-view="notes"]').click(); await only(page, 'notes');
    await page.locator('#notesQuickCaptureInput').fill('Проверка заметки');
    await page.locator('#notesQuickCaptureInput').press('Enter');
    await expect(page.locator('#noteList')).toContainText('Проверка заметки');
    await page.locator('.bottom-nav [data-view="today"]').click(); await only(page, 'today');
  }
  const nav = phone ? '.bottom-nav' : '.side-nav';
  for (const view of ['calendar', 'notes', 'today']) { await page.locator(`${nav} [data-view="${view}"]`).click(); await only(page, view); }
  if (phone) {
    await expect(page.locator('#todayFocusWidget')).toBeHidden();
    await page.locator('#sever2HomeCore [data-home-action="focus"]').click(); await only(page, 'timer');
    for (const view of ['habits', 'progress', 'settings']) {
      await page.locator('#mobileNavMore').click();
      await page.locator(view === 'settings' ? '#openSettingsMenu' : `[data-menu-view="${view}"]`).click(); await only(page, view);
    }
  } else { await expect(page.locator('.desktop-sidebar')).toBeVisible(); }
});
test('one timer completes linked task once; pause and reset retain correct state', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(async () => {
    const s = window.SeverApp.getState(), now = Date.now();
    s.tasks.push({ id: 'timer-test', title: 'Фокус', date: new Date(now).toLocaleDateString('en-CA'), duration: 1, completed: false, category: 'Личное', createdAt: now, updatedAt: now });
    await window.SeverApp.persist(); window.SeverApp.startTimer({ taskId: 'timer-test' });
  });
  await only(page, 'timer');
  await page.clock.runFor(1000); await page.locator('#timerToggle').click();
  const paused = await page.locator('#timerDisplay').textContent(); await page.clock.runFor(1000); await expect(page.locator('#timerDisplay')).toHaveText(paused);
  await page.locator('#timerToggle').click(); await page.clock.runFor(61000);
  await only(page, 'today');
  const result = await page.evaluate(() => { const s = window.SeverApp.getState(); return { task: s.tasks.find(t => t.id === 'timer-test'), sessions: s.focusSessions, count: s.stats.sessions, active: window.SeverApp.getContext().activeTimerId }; });
  expect(result.task.completed).toBe(true); expect(result.task.completedAt).toBeGreaterThan(0); expect(result.sessions).toHaveLength(1); expect(result.count).toBe(1); expect(result.active).toBe('');
  await page.clock.runFor(2000); expect(await page.evaluate(() => window.SeverApp.getState().focusSessions.length)).toBe(1);
  await page.evaluate(() => window.SeverApp.switchView('timer')); await page.locator('#timerReset').click(); await expect(page.locator('#timerDisplay')).toHaveText('01:00');
});
