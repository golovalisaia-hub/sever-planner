const views = ['today', 'calendar', 'timer', 'notes', 'habits', 'progress', 'settings', 'ai'];
const { baseURL } = require('./test-server-config.cjs');
const sizes = [[390, 844], [1440, 900]];
async function boot(page, theme = 'calm') {
  await page.route('**/supabase-config.js*', r => r.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(theme => {
    // This matrix isolates UI from SW upgrades; offline/restart has a real-SW test.
    delete Navigator.prototype.serviceWorker;
    if (!localStorage.getItem('sever-anonymous-state-v1')) {
      const date = new Date().toLocaleDateString('sv-SE');
      localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
        tasks: [{ id: 'theme-task', title: 'Спланировать спокойный день', date, completed: false, duration: 25, category: 'Личное' }],
        notes: [{ id: 'theme-note', title: 'Идеи на неделю', body: 'Оставить время для важного', kind: 'text' }],
        habits: [{ id: 'theme-habit', title: 'Читать каждый день' }], folders: [], checks: {},
        onboarded: true, appearance: { theme, animations: 'off', reduceEffects: true }
      }));
    }
  }, theme);
  await page.goto(baseURL + '/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes);
}
async function show(page, view) {
  await page.evaluate(v => window.SeverApp.switchView(v === 'ai' ? 'today' : v), view);
  if (view === 'ai') await page.locator('#severAiOpen').click();
  await page.mouse.move(0, 0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(300);
}
async function geometry(page) {
  return page.evaluate(() => {
    const selectors = ['.app-shell', '.app-shell main', '.topbar', '.desktop-sidebar', '.desktop-rail', '.bottom-nav',
      '.view.active', '.view.active .heading', '#todayView .today-hero', '#todayDashboard',
      '#todayTasks', '#todayView .task', '#todayFocusWidget', '#mobileQuickNote',
      '#calendarView .calendar', '#calendarView .day', '#timerView .focus-card', '#timerDisplay',
      '#notesView .note-card', '#habitsView .habit', '#progressView .stats', '#progressView .heat-card',
      '.settings-appearance', '#severAiOpen', '#severAiPanel.open'];
    return Object.fromEntries(selectors.flatMap(selector => [...document.querySelectorAll(selector)].flatMap((el, i) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return [];
      return [[`${selector}:${i}`, ['x', 'y', 'width', 'height'].map(k => Math.round(r[k] * 100) / 100)]];
    })));
  });
}
module.exports = { views, sizes, boot, show, geometry };
