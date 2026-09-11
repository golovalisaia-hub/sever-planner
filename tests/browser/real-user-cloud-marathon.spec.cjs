const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);

const cloud = {
  url: process.env.SEVER_AUTH_TEST_URL?.replace(/\/$/, ''),
  anonKey: process.env.SEVER_AUTH_TEST_ANON_KEY,
  email: process.env.SEVER_AUTH_TEST_EMAIL,
  password: process.env.SEVER_AUTH_TEST_PASSWORD
};
const liveReady = Object.values(cloud).every(Boolean);

function configScript() {
  return `window.SEVER_SUPABASE_CONFIG=${JSON.stringify({ url: cloud.url, anonKey: cloud.anonKey })};window.SEVER_CLOUD_ENABLED=true;`;
}

async function prepare(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: configScript() }));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: true, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverCloud && window.SeverCloudUI && window.SeverCloudReady);
}

async function login(page) {
  await page.evaluate(() => window.SeverCloudUI.openAccount());
  await expect(page.locator('#accountDialog')).toBeVisible();
  await page.locator('#accountEmailInput').fill(cloud.email);
  await page.locator('#accountPassword').fill(cloud.password);
  await page.locator('#accountSubmit').click();
  await expect(page.locator('#accountDialog')).toBeHidden({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => ({
    id: window.SeverCloud?.user?.id || '',
    hydrated: Boolean(window.SeverCloud?.hydrated),
    status: window.SeverCloud?.status || ''
  })), { timeout: 30000 }).toMatchObject({ hydrated: true });
  const userId = await page.evaluate(() => window.SeverCloud.user?.id || '');
  expect(userId).toBeTruthy();
  return userId;
}

async function flush(page) {
  await page.evaluate(async () => {
    window.SeverCloud?.capture?.();
    await window.SeverCloud?.flush?.();
    await window.SeverCloud?.pull?.();
  });
  await expect.poll(() => page.evaluate(() => window.SeverCloud?.queued?.length || 0), { timeout: 20000 }).toBe(0);
}

async function openCreate(page) {
  const mobile = page.locator('#mobileCreateBtn');
  if (await mobile.isVisible()) await mobile.click();
  else await page.locator('#globalAddBtn').click();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
}

async function createTask(page, title) {
  await page.evaluate(() => window.SeverApp.switchView('today'));
  await openCreate(page);
  await page.locator('#quickCaptureInput').fill(title);
  await page.locator('#quickCaptureForm button[type="submit"]').click();
  await expect(page.locator('#todayTasks')).toContainText(title);
  const id = await page.evaluate(value => window.SeverApp.getState().tasks.find(task => task.title === value)?.id || '', title);
  expect(id).toBeTruthy();
  return id;
}

async function createNote(page, title) {
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await page.locator('#notesQuickCaptureInput').fill(title);
  await page.locator('#notesQuickCaptureInput').press('Enter');
  await expect(page.locator('#noteList')).toContainText(title);
  const id = await page.evaluate(value => window.SeverApp.getState().notes.find(note => note.title === value)?.id || '', title);
  expect(id).toBeTruthy();
  return id;
}

async function createHabit(page, title) {
  await page.evaluate(() => window.SeverApp.switchView('habits'));
  await page.locator('#openHabit').click();
  await page.locator('#habitTitle').fill(title);
  await page.locator('#habitSubmit').click();
  await expect(page.locator('#habitList')).toContainText(title);
  const id = await page.evaluate(value => window.SeverApp.getState().habits.find(habit => habit.title === value)?.id || '', title);
  expect(id).toBeTruthy();
  return id;
}

async function remoteRow(page, table, id) {
  return page.evaluate(async ({ table, id }) => {
    const client = await window.SeverSupabase.getClient();
    const { data, error } = await client.from(table).select('*').eq('id', id).maybeSingle();
    return { data, error: error ? { message: error.message, code: error.code } : null };
  }, { table, id });
}

async function cleanup(page, created) {
  if (page.isClosed()) return;
  try {
    await page.evaluate(async ({ taskIds, noteIds, habitIds }) => {
      const client = await window.SeverSupabase.getClient();
      if (habitIds.length) await client.from('habit_entries').delete().in('habit_id', habitIds);
      if (noteIds.length) await client.from('notes').delete().in('id', noteIds);
      if (taskIds.length) await client.from('focus_sessions').delete().in('task_id', taskIds);
      if (taskIds.length) await client.from('tasks').delete().in('id', taskIds);
      if (habitIds.length) await client.from('habits').delete().in('id', habitIds);
      await client.auth.signOut({ scope: 'local' });
    }, created);
  } catch {}
}

test('disposable account behaves like a real two-device user and cleans up after itself', async ({ browser }, info) => {
  test.skip(!liveReady, 'Disposable cloud Auth configuration is unavailable');

  const viewport = info.project.use.viewport || { width: 390, height: 844 };
  const contextA = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const contextB = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const created = { taskIds: [], noteIds: [], habitIds: [] };
  const token = `QA-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  try {
    await prepare(pageA);
    const userA = await login(pageA);
    expect(userA).toBeTruthy();

    const taskTitle = `${token} задача`;
    const taskId = await createTask(pageA, taskTitle);
    created.taskIds.push(taskId);
    const noteTitle = `${token} заметка`;
    const noteId = await createNote(pageA, noteTitle);
    created.noteIds.push(noteId);
    const habitTitle = `${token} привычка`;
    const habitId = await createHabit(pageA, habitTitle);
    created.habitIds.push(habitId);
    await pageA.locator('#habitList .habit').filter({ hasText: habitTitle }).locator('.habit-day.today').click();
    await flush(pageA);

    const remoteTask = await remoteRow(pageA, 'tasks', taskId);
    const remoteNote = await remoteRow(pageA, 'notes', noteId);
    const remoteHabit = await remoteRow(pageA, 'habits', habitId);
    expect(remoteTask.error).toBeNull();
    expect(remoteTask.data?.title).toBe(taskTitle);
    expect(remoteNote.error).toBeNull();
    expect(remoteNote.data?.title).toBe(noteTitle);
    expect(remoteHabit.error).toBeNull();
    expect(remoteHabit.data?.title).toBe(habitTitle);

    // A fresh second browser context signs in independently and receives the same cloud state.
    await prepare(pageB);
    const userB = await login(pageB);
    expect(userB).toBe(userA);
    await pageB.evaluate(async () => window.SeverCloud.pull());
    await expect.poll(() => pageB.evaluate(({ taskId, noteId, habitId }) => ({
      task: window.SeverApp.getState().tasks.some(item => item.id === taskId),
      note: window.SeverApp.getState().notes.some(item => item.id === noteId),
      habit: window.SeverApp.getState().habits.some(item => item.id === habitId)
    }), { taskId, noteId, habitId }), { timeout: 20000 }).toEqual({ task: true, note: true, habit: true });

    // Edit on device B, then force a pull on A: no stale copy may win.
    await pageB.evaluate(() => window.SeverApp.switchView('today'));
    const taskCardB = pageB.locator('#todayTasks .task').filter({ hasText: taskTitle });
    await taskCardB.locator('.task-open').click();
    await pageB.locator('#taskActionEdit').click();
    const editedTitle = `${taskTitle} B`;
    await pageB.locator('#taskTitle').fill(editedTitle);
    await pageB.locator('#taskForm .primary').click();
    await flush(pageB);
    await pageA.evaluate(async () => window.SeverCloud.pull());
    await expect.poll(() => pageA.evaluate(id => window.SeverApp.getState().tasks.find(task => task.id === id)?.title || '', taskId), { timeout: 20000 }).toBe(editedTitle);

    // Offline work on A must remain instant locally, queue, then reach B after reconnection.
    await contextA.setOffline(true);
    const offlineTitle = `${token} offline`;
    const offlineTaskId = await createTask(pageA, offlineTitle);
    created.taskIds.push(offlineTaskId);
    await expect.poll(() => pageA.evaluate(() => window.SeverCloud?.queued?.length || 0)).toBeGreaterThan(0);
    await contextA.setOffline(false);
    await pageA.evaluate(async () => {
      await window.SeverCloud.restoreSession({ throwOnError: true });
      await window.SeverCloud.flush();
    });
    await expect.poll(() => pageA.evaluate(() => window.SeverCloud?.queued?.length || 0), { timeout: 30000 }).toBe(0);
    await pageB.evaluate(async () => window.SeverCloud.pull());
    await expect.poll(() => pageB.evaluate(id => window.SeverApp.getState().tasks.some(task => task.id === id), offlineTaskId), { timeout: 20000 }).toBe(true);

    // Delete from A and verify B no longer shows the task after pull.
    await pageA.evaluate(() => window.SeverApp.switchView('today'));
    await pageA.locator('#todayTasks .task').filter({ hasText: editedTitle }).locator('.task-open').click();
    await pageA.locator('#taskActionDelete').click();
    await flush(pageA);
    await pageB.evaluate(async () => window.SeverCloud.pull());
    await expect.poll(() => pageB.evaluate(id => window.SeverApp.getState().tasks.some(task => task.id === id), taskId), { timeout: 20000 }).toBe(false);

    // Reload and login restoration: remaining cloud data must survive a full page refresh.
    await pageA.reload();
    await pageA.waitForFunction(() => window.SeverApp && window.SeverCloud && window.SeverCloudReady);
    await expect.poll(() => pageA.evaluate(id => window.SeverApp.getState().tasks.some(task => task.id === id), offlineTaskId), { timeout: 30000 }).toBe(true);

    // Explicit sign-out must return to anonymous scope and hide cloud data.
    await pageA.evaluate(() => window.SeverCloudUI.openAccount());
    await pageA.locator('#accountSignOut').click();
    await expect.poll(() => pageA.evaluate(() => Boolean(window.SeverCloud?.user))).toBe(false);
    expect(await pageA.evaluate(id => window.SeverApp.getState().tasks.some(task => task.id === id), offlineTaskId)).toBe(false);
  } finally {
    await cleanup(pageA, created);
    await cleanup(pageB, created);
    await contextA.close();
    await contextB.close();
  }
});
