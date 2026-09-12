const { test, expect } = require('@playwright/test');

test('sever:ready fires only after the initial state is durably saved', async ({ page }) => {
  await page.addInitScript(() => {
    window.__severReadyAudit = [];
    window.addEventListener('sever:ready', () => {
      let savedAt = 0;
      try {
        savedAt = Number(JSON.parse(localStorage.getItem('sever-anonymous-state-v1') || '{}')._savedAt) || 0;
      } catch {}
      window.__severReadyAudit.push({
        savedAt,
        storageStatus: document.querySelector('#storageStatus')?.textContent?.trim() || ''
      });
    });
  });

  await page.goto('/');
  await expect.poll(async () => page.evaluate(() => window.__severReadyAudit?.length || 0)).toBe(1);

  const snapshot = await page.evaluate(() => window.__severReadyAudit[0]);
  expect(snapshot.savedAt).toBeGreaterThan(0);
  expect(snapshot.storageStatus).toBeTruthy();
  expect(snapshot.storageStatus).not.toMatch(/Проверяем/i);
});
