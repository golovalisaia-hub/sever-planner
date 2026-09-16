const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.addInitScript(() => {
    const today = new Date().toLocaleDateString('sv-SE');
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks: [{
        id: 'task-touch-v113', title: 'ПДД', date: today, time: '', duration: 20,
        category: 'Учёба', priority: false, challenge: false, completed: false,
        createdAt: Date.now(), updatedAt: Date.now()
      }],
      notes: [], folders: [], habits: [], checks: {}, taskMemory: [], profile: { name: '' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
}

async function touchGesture(locator, pointerId) {
  await locator.evaluate((element, id) => {
    element.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: 'touch',
      isPrimary: true
    }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  }, pointerId);
}

test('phone task checkbox consumes only one click per physical touch gesture', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('phone-'), 'mobile interaction regression');
  await seed(page);
  await page.goto('/');

  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severInteractionPolishVersion)).toBe('v113');
  let check = page.locator('#todayTasks .task .check').first();
  await expect(check).toHaveAttribute('data-sever-task-input', 'v113');

  const styles = await check.evaluate(element => {
    const computed = getComputedStyle(element);
    return { userSelect: computed.userSelect, webkitUserSelect: computed.webkitUserSelect };
  });
  expect(styles.userSelect).toBe('none');
  expect(['none', '']).toContain(styles.webkitUserSelect);

  const selectStartAllowed = await check.evaluate(element => element.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true })));
  expect(selectStartAllowed).toBe(false);

  await touchGesture(check, 41);
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks[0].completed)).toBe(true);

  // The first click rerenders Today. A second synthetic click from the same
  // pointer gesture must still be rejected even though the checkbox DOM node changed.
  check = page.locator('#todayTasks .task .check').first();
  await expect(check).toHaveAttribute('data-sever-task-input', 'v113');
  await check.evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
  await page.waitForTimeout(40);
  expect(await page.evaluate(() => window.SeverApp.getState().tasks[0].completed)).toBe(true);
  await expect(page.locator('#taskActionDialog')).not.toBeVisible();

  // A real second tap has its own pointerdown and must remain a deliberate toggle.
  check = page.locator('#todayTasks .task .check').first();
  await touchGesture(check, 42);
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks[0].completed)).toBe(false);
});
