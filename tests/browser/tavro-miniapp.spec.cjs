// TAVRO Mini App in a real browser.
//
// The API is intercepted, so these tests exercise the actual interface: taps,
// sheets, the microphone state machine, tab switching, offline behaviour and
// layout at 320 px. Every assertion is about something a user can see or do.

const { test, expect } = require('@playwright/test');

const TODAY = new Date().toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const profile = (overrides = {}) => ({
  firstName: 'Лиса', timezone: 'Europe/Moscow', remindersEnabled: true,
  plan: 'free', planTitle: 'FREE', pro: false, dailyAiActions: 3,
  expiresAt: null, autoRenew: false, lapsed: false, ...overrides,
});

const PREVIEW = {
  today: TODAY,
  clarification: null,
  items: [
    { type: 'event', label: 'Встреча', title: 'Встреча с Андреем', date: TOMORROW, time: '15:00', when: 'завтра, 15:00', location: null, participants: ['Андрей'] },
    { type: 'task', label: 'Задача', title: 'Изучить Python', date: null, time: null, when: 'без даты', participants: [] },
    { type: 'task', label: 'Задача', title: 'Оплатить интернет', date: null, time: null, when: 'без даты', participants: [] },
    { type: 'diary', label: 'Дневник', title: 'Закончил проект', date: TODAY, time: null, when: 'сегодня', participants: [] },
  ],
};

/** Installs a fake backend and a fake Telegram client. */
async function mockApp(page, { overrides = {}, telegram = true } = {}) {
  const calls = [];

  await page.addInitScript(({ telegram }) => {
    globalThis.TAVRO_API_BASE = 'https://api.test.invalid/functions/v1/tavro-api';
    globalThis.TAVRO_INIT_DATA = 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=test';
    if (telegram) {
      globalThis.Telegram = {
        WebApp: {
          initData: 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=test',
          ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {},
          BackButton: { show() {}, hide() {}, onClick() {} },
          HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
          openInvoice(url, callback) { globalThis.__invoice = url; callback('paid'); },
        },
      };
    }
    // No microphone in the test browser: the app must fall back to text.
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
  }, { telegram });

  const responses = {
    'GET /today': () => ({
      today: TODAY, timezone: 'Europe/Moscow', profile: profile(), aiConfigured: true,
      agenda: { date: TODAY, tasks: [], events: [] },
      overdue: [{ id: 'task-old', title: 'Просроченная задача', scheduled_for: '2020-01-01', scheduled_time: null }],
      upcoming: [{ kind: 'event', id: 'event-1', title: 'Встреча с Андреем', date: TOMORROW, time: '15:00' }],
      inbox: [{ id: 'task-1', title: 'Оплатить интернет', scheduled_time: null, category: 'Личное', priority: false }],
    }),
    'POST /capture': () => ({ captureId: 'capture-1', preview: PREVIEW }),
    'POST /capture/confirm': () => ({ ok: true, saved: PREVIEW.items.map((item, index) => ({ kind: item.type, id: `saved-${index}`, title: item.title, date: item.date, time: item.time })), today: TODAY }),
    'POST /capture/discard': () => ({ ok: true }),
    'POST /task/complete': () => ({ task: { id: 'task-1', title: 'Оплатить интернет', completed: true } }),
    'GET /calendar': () => ({ today: TODAY, from: TODAY, to: TODAY, tasks: [], events: [{ id: 'event-1', title: 'Встреча с Андреем', event_date: TOMORROW, event_time: '15:00', status: 'planned' }] }),
    'GET /tasks': () => ({ today: TODAY, inbox: [{ id: 'task-1', title: 'Оплатить интернет', scheduled_for: null, scheduled_time: null }], overdue: [] }),
    'GET /notes': () => ({ today: TODAY, kind: 'note', notes: [{ id: 'note-1', title: 'Мысль про проект', body: 'Мысль про проект', entry_date: TODAY, photo_file_id: null, photo_summary: null }] }),
    'GET /habits': () => ({ today: TODAY, habits: [{ id: 'habit-1', title: 'Читать', target_per_week: 7 }], entries: [] }),
    'POST /habit/toggle': () => ({ entry: { habit_id: 'habit-1', entry_date: TODAY, completed: true } }),
    'GET /progress': () => ({ today: TODAY, from: TODAY, to: TODAY, total: 10, completed: 7, percent: 70 }),
    'GET /me': () => ({
      today: TODAY, timezone: 'Europe/Moscow', profile: profile(), aiConfigured: true, quickTokens: [],
      plans: [
        { id: 'free', title: 'FREE', rub: 0, billing: 'free', summary: 'Планер целиком.', dailyAiActions: 3, fairUse: '3 AI-действия в день.', stars: null, available: true },
        { id: 'pro_month', title: 'PRO — месяц', rub: 250, billing: 'subscription', summary: 'Автопродление.', dailyAiActions: 100, fairUse: '100 AI-действий в день.', stars: 500, available: true },
        { id: 'pro_year', title: 'PRO — год', rub: 1800, billing: 'one_time', summary: 'Разовая покупка.', dailyAiActions: 100, fairUse: '100 AI-действий в день.', stars: null, available: false },
        { id: 'pro_lifetime', title: 'PRO — навсегда', rub: 5000, billing: 'one_time', summary: 'Без срока.', dailyAiActions: 50, fairUse: '50 AI-действий в день. Норму не снижаем.', stars: null, available: false },
      ],
    }),
    'POST /settings': () => ({ profile: profile({ remindersEnabled: false }) }),
    'POST /quick-token': () => ({ token: 'tvq_test-token-value', id: 'token-1' }),
    'POST /invoice': () => ({ url: 'https://t.me/invoice/test', stars: 500 }),
    ...overrides,
  };

  await page.route('**/tavro-api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/tavro-api/, '') || '/';
    const key = `${request.method()} ${path}`;
    calls.push({ key, body: request.postDataJSON?.() ?? null });
    const handler = responses[key] ?? responses[`${request.method()} ${path.split('?')[0]}`];
    if (!handler) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NOT_FOUND', message: 'нет маршрута' }) });
    const result = await handler(request);
    if (result?.__status) return route.fulfill({ status: result.__status, contentType: 'application/json', body: JSON.stringify(result.body) });
    if (result?.__abort) return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });

  await page.goto('/tavro/');
  await expect(page.locator('#todayDate')).not.toHaveText('—');
  return { calls };
}

// ------------------------------------------------------------------- today ---

test('главный экран показывает реальные ближайшие дела, а не пустые карточки', async ({ page }) => {
  await mockApp(page);

  await expect(page.locator('#todayUpcoming')).toContainText('Встреча с Андреем');
  await expect(page.locator('#todayUpcoming')).toContainText('завтра, 15:00');
  await expect(page.locator('#todayOverdue')).toContainText('Просроченная задача');
  await expect(page.locator('#todayInbox')).toContainText('Оплатить интернет');
  // An undated task says so rather than claiming to be today.
  await expect(page.locator('#todayInbox')).toContainText('без даты');
  await expect(page.locator('#planBadge')).toHaveText('FREE');

  // The microphone is the primary action: a comfortable thumb target, taller
  // than the navigation bar it floats above. (Nav buttons stretch on desktop,
  // so width is not the comparison that means anything here.)
  const mic = await page.locator('#micButton').boundingBox();
  const tab = await page.locator('.tabbar button').first().boundingBox();
  expect(mic.width).toBeGreaterThanOrEqual(56);
  expect(mic.height).toBeGreaterThan(tab.height);
  expect(Math.abs(mic.width - mic.height)).toBeLessThan(2);
});

test('пустой день объясняет, что делать дальше', async ({ page }) => {
  await mockApp(page, {
    overrides: {
      'GET /today': () => ({
        today: TODAY, timezone: 'Europe/Moscow', profile: profile(), aiConfigured: true,
        agenda: { date: TODAY, tasks: [], events: [] }, overdue: [], upcoming: [], inbox: [],
      }),
    },
  });
  await expect(page.locator('#todayUpcoming')).toContainText('Нажмите микрофон');
  await expect(page.locator('#todayOverdueLabel')).toBeHidden();
});

// ----------------------------------------------------------------- capture ---

test('главный сценарий: фраза → предпросмотр → сохранение одной кнопкой', async ({ page }) => {
  const { calls } = await mockApp(page);

  // No microphone in this client, so the mic button opens the text path.
  await page.locator('#micButton').click();
  await expect(page.locator('#sheet')).toBeVisible();
  await expect(page.locator('#sheetBody')).toContainText('микрофон');

  await page.locator('#composeText').fill('завтра встреча с Андреем в 15:00, потом изучить Python и оплатить интернет');
  await page.locator('#composeSend').click();

  await expect(page.locator('#sheetTitle')).toHaveText('Нашёл 4');
  await expect(page.locator('.draft-item')).toHaveCount(4);
  await expect(page.locator('.draft-item').first()).toContainText('Встреча с Андреем');
  await expect(page.locator('.draft-item').first()).toContainText('завтра, 15:00');
  await expect(page.locator('.draft-item').nth(1)).toContainText('без даты');
  await expect(page.locator('#micButton')).toHaveAttribute('data-state', 'preview');

  await page.locator('#draftSave').click();
  await expect(page.locator('#sheet')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Сохранено: 4');

  const confirm = calls.find(call => call.key === 'POST /capture/confirm');
  expect(confirm.body.keep).toEqual([0, 1, 2, 3]);
});

test('лишнюю запись можно снять до сохранения', async ({ page }) => {
  const { calls } = await mockApp(page);
  await page.locator('#micButton').click();
  await page.locator('#composeText').fill('фраза');
  await page.locator('#composeSend').click();
  await expect(page.locator('.draft-item')).toHaveCount(4);

  await page.locator('.draft-item').nth(1).click();
  await expect(page.locator('.draft-item').nth(1)).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#draftSave').click();

  await expect.poll(() => calls.some(call => call.key === 'POST /capture/confirm')).toBe(true);
  const confirm = calls.find(call => call.key === 'POST /capture/confirm');
  expect(confirm.body.keep).toEqual([0, 2, 3]);
});

test('сняв все записи, нельзя нажать «Сохранить»', async ({ page }) => {
  await mockApp(page);
  await page.locator('#micButton').click();
  await page.locator('#composeText').fill('фраза');
  await page.locator('#composeSend').click();
  for (let index = 0; index < 4; index += 1) await page.locator('.draft-item').nth(index).click();
  await expect(page.locator('#draftSave')).toBeDisabled();
});

test('двойное нажатие «Сохранить» отправляет один запрос', async ({ page }) => {
  const { calls } = await mockApp(page, {
    overrides: {
      'POST /capture/confirm': async () => {
        await new Promise(resolve => setTimeout(resolve, 350));
        return { ok: true, saved: [{ kind: 'task', id: 's1', title: 'Оплатить интернет', date: null, time: null }], today: TODAY };
      },
    },
  });
  await page.locator('#micButton').click();
  await page.locator('#composeText').fill('фраза');
  await page.locator('#composeSend').click();

  const save = page.locator('#draftSave');
  await save.click();
  await save.click({ force: true }).catch(() => {});
  await expect(page.locator('#toast')).toContainText('Сохранено');
  expect(calls.filter(call => call.key === 'POST /capture/confirm')).toHaveLength(1);
});

test('отмена черновика ничего не сохраняет и сообщает серверу', async ({ page }) => {
  const { calls } = await mockApp(page);
  await page.locator('#micButton').click();
  await page.locator('#composeText').fill('фраза');
  await page.locator('#composeSend').click();
  await page.locator('#draftDiscard').click();

  await expect(page.locator('#sheet')).toBeHidden();
  await expect.poll(() => calls.some(call => call.key === 'POST /capture/discard')).toBe(true);
  expect(calls.some(call => call.key === 'POST /capture/confirm')).toBe(false);
});

test('ошибка сети объясняется, а не молчит', async ({ page }) => {
  await mockApp(page, { overrides: { 'POST /capture': () => ({ __abort: true }) } });
  await page.locator('#micButton').click();
  await page.locator('#composeText').fill('фраза');
  await page.locator('#composeSend').click();
  await expect(page.locator('#sheetBody')).toContainText('Нет связи с сервером');
  // The text is preserved in a reopened composer rather than lost silently.
  await expect(page.locator('#composeText')).toBeVisible();
});

test('исчерпанный лимит объясняет, что планер продолжает работать', async ({ page }) => {
  await mockApp(page, {
    overrides: {
      'POST /capture': () => ({ __status: 429, body: { error: 'QUOTA_EXCEEDED', message: 'Дневной лимит ИИ исчерпан: 3 действия в сутки. Планер не ограничен.' } }),
    },
  });
  await page.locator('#micButton').click();
  await page.locator('#composeText').fill('фраза');
  await page.locator('#composeSend').click();
  await expect(page.locator('#sheetBody')).toContainText('лимит ИИ исчерпан');
  await expect(page.locator('#sheetBody')).toContainText('Планер не ограничен');
});

// ------------------------------------------------------------------ tasks ---

test('задача закрывается тапом и её можно вернуть', async ({ page }) => {
  const { calls } = await mockApp(page);
  await page.locator('#todayInbox .row').first().click();
  await expect(page.locator('#toast')).toContainText('Выполнено');

  // The undo button lives in the toast, which auto-dismisses, so click it while
  // it is up and then wait for the request rather than assuming it has landed.
  await page.locator('#toast button').click();
  await expect.poll(() => calls.filter(call => call.key === 'POST /task/complete').length).toBe(2);
  const completes = calls.filter(call => call.key === 'POST /task/complete');
  expect(completes[0].body.completed).toBe(true);
  expect(completes[1].body.completed).toBe(false);
});

// -------------------------------------------------------- navigation, tabs ---

test('все вкладки открываются и показывают свои данные', async ({ page }) => {
  await mockApp(page);

  await page.locator('.tabbar button[data-view="calendar"]').click();
  await expect(page.locator('#viewCalendar')).toBeVisible();
  await expect(page.locator('.cal-day')).toHaveCount(42);
  await expect(page.locator('#calMonth')).not.toHaveText('—');

  // Picking a day shows that day's records.
  await page.locator(`.cal-day[data-date="${TOMORROW}"]`).click();
  await expect(page.locator(`.cal-day[data-date="${TOMORROW}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#calDayItems')).toContainText('Встреча с Андреем');

  await page.locator('.tabbar button[data-view="records"]').click();
  await expect(page.locator('#recordsList')).toContainText('Оплатить интернет');
  await page.locator('[data-records-tab="note"]').click();
  await expect(page.locator('#recordsList')).toContainText('Мысль про проект');

  await page.locator('.tabbar button[data-view="more"]').click();
  await expect(page.locator('#habitsList')).toContainText('Читать');
  await page.locator('[data-more-tab="progress"]').click();
  await expect(page.locator('#progressPercent')).toContainText('70');
  await expect(page.locator('#progressMeter')).toHaveAttribute('style', /width:\s*70%/);

  await page.locator('[data-more-tab="settings"]').click();
  await expect(page.locator('#plansList')).toContainText('250 ₽');
  await expect(page.locator('#plansList')).toContainText('5000 ₽');

  await page.locator('.tabbar button[data-view="today"]').click();
  await expect(page.locator('#viewToday')).toBeVisible();
});

test('каждая кнопка на экране имеет обработчик', async ({ page }) => {
  await mockApp(page);
  // Nothing in the shell is a decorative control: every button either navigates,
  // toggles a tab, or is wired through a delegated handler with a data hook.
  const orphans = await page.evaluate(() => {
    const wired = element => Boolean(
      element.dataset.view || element.dataset.recordsTab || element.dataset.moreTab
      || element.dataset.buy || element.dataset.revoke || element.dataset.draft
      || element.dataset.habit || element.dataset.date
      // Record rows are delegated by id + kind.
      || (element.dataset.id && element.dataset.kind)
      || element.id,
    );
    return [...document.querySelectorAll('button')].filter(button => button.offsetParent !== null && !wired(button)).map(button => button.outerHTML.slice(0, 80));
  });
  expect(orphans).toEqual([]);
});

test('привычка отмечается за день', async ({ page }) => {
  const { calls } = await mockApp(page);
  await page.locator('.tabbar button[data-view="more"]').click();
  await page.locator('.habit-day').last().click();
  await expect(page.locator('.habit-day').last()).toHaveAttribute('data-done', 'true');
  await expect.poll(() => calls.some(call => call.key === 'POST /habit/toggle')).toBe(true);
});

// --------------------------------------------------------------- settings ---

test('настройки переключают напоминания и выдают токен быстрого ввода', async ({ page }) => {
  const { calls } = await mockApp(page);
  await page.locator('.tabbar button[data-view="more"]').click();
  await page.locator('[data-more-tab="settings"]').click();

  await expect(page.locator('#remindersSwitch')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#remindersSwitch').click();
  await expect(page.locator('#remindersSwitch')).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => calls.some(call => call.key === 'POST /settings')).toBe(true);
  expect(calls.find(call => call.key === 'POST /settings').body.remindersEnabled).toBe(false);

  await page.locator('#issueToken').click();
  await expect(page.locator('#sheetBody')).toContainText('tvq_test-token-value');
  await expect(page.locator('#sheetBody')).toContainText('только создавать записи');
});

test('тариф без цены в Stars не предлагает покупку', async ({ page }) => {
  await mockApp(page);
  await page.locator('.tabbar button[data-view="more"]').click();
  await page.locator('[data-more-tab="settings"]').click();

  await expect(page.locator('[data-buy="pro_month"]')).toBeVisible();
  await expect(page.locator('[data-buy="pro_year"]')).toHaveCount(0);
  await expect(page.locator('#plansList')).toContainText('Цена в Stars пока не настроена');
  // A yearly purchase is never labelled as renewing.
  await expect(page.locator('#plansList')).toContainText('разовая покупка');

  await page.locator('[data-buy="pro_month"]').click();
  await expect.poll(() => page.evaluate(() => globalThis.__invoice)).toBe('https://t.me/invoice/test');
});

// ----------------------------------------------------------------- layout ---

test('интерфейс помещается по ширине и не требует горизонтальной прокрутки', async ({ page }, testInfo) => {
  await mockApp(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `горизонтальная прокрутка на ${testInfo.project.name}`).toBeLessThanOrEqual(1);

  // The microphone must not sit on top of a navigation item.
  const mic = await page.locator('#micButton').boundingBox();
  for (const index of [0, 1, 2, 3]) {
    const tab = await page.locator('.tabbar button').nth(index).boundingBox();
    const overlapX = Math.min(mic.x + mic.width, tab.x + tab.width) - Math.max(mic.x, tab.x);
    const overlapY = Math.min(mic.y + mic.height, tab.y + tab.height) - Math.max(mic.y, tab.y);
    expect(overlapX <= 0 || overlapY <= 0, `микрофон перекрывает вкладку ${index}`).toBe(true);
  }
});

test('лист предпросмотра прокручивается и не уезжает за экран', async ({ page }) => {
  await mockApp(page);
  await page.locator('#micButton').click();
  await page.locator('#composeText').fill('фраза');
  await page.locator('#composeSend').click();

  const sheet = await page.locator('#sheet').boundingBox();
  const viewport = page.viewportSize();
  expect(sheet.y).toBeGreaterThanOrEqual(0);
  expect(sheet.x + sheet.width).toBeLessThanOrEqual(viewport.width + 1);
  await expect(page.locator('#draftSave')).toBeInViewport();
});

test('смена ориентации не ломает раскладку', async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width: 740, height: 360 });
  await expect(page.locator('#micButton')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('.tabbar')).toBeVisible();
});

test('IMPULSE использует свою палитру, а не мятную тему SEVER', async ({ page }) => {
  await mockApp(page);
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      bg: style.getPropertyValue('--bg').trim(),
      accent: style.getPropertyValue('--accent').trim(),
      card: style.getPropertyValue('--card').trim(),
      text: style.getPropertyValue('--text').trim(),
      body: getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(tokens.bg.toUpperCase()).toBe('#080809');
  expect(tokens.accent.toUpperCase()).toBe('#FF5A1F');
  expect(tokens.card.toUpperCase()).toBe('#18181B');
  expect(tokens.text.toUpperCase()).toBe('#F5F5F2');
  expect(tokens.body).toBe('rgb(8, 8, 9)');
});

test('reduced motion убирает анимации', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApp(page);
  const duration = await page.evaluate(() => getComputedStyle(document.querySelector('#viewToday')).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});

test('возврат из фона перечитывает состояние', async ({ page }) => {
  const { calls } = await mockApp(page);
  const before = calls.filter(call => call.key === 'GET /today').length;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => calls.filter(call => call.key === 'GET /today').length).toBeGreaterThan(before);
});
