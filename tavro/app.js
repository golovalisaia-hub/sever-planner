/* TAVRO Mini App.
 *
 * Every control on screen calls a real endpoint. The microphone is the primary
 * action and does not ask which section you meant: one phrase goes to the
 * server, comes back as reviewable records, and you save them with one button.
 */

const tg = globalThis.Telegram?.WebApp;
const API_BASE = globalThis.TAVRO_API_BASE
  || document.documentElement.dataset.api
  || 'https://api.tavro.app/functions/v1/tavro-api';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const TIMEZONES = [
  'Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk',
  'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok',
  'Asia/Magadan', 'Asia/Kamchatka', 'Europe/Kyiv', 'Europe/Minsk', 'Asia/Almaty', 'Asia/Tbilisi',
  'Asia/Yerevan', 'Asia/Dubai', 'Europe/Istanbul', 'Europe/Belgrade', 'Europe/Berlin', 'Europe/Lisbon', 'UTC',
];

const state = {
  today: null,
  profile: null,
  data: { upcoming: [], overdue: [], inbox: [], agenda: null },
  view: 'today',
  recordsTab: 'tasks',
  moreTab: 'habits',
  calendar: { month: null, selected: null, tasks: [], events: [] },
  capture: null,
  busy: new Set(),
  lastUndo: null,
};

// ------------------------------------------------------------------- utils --

const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));

const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function formatWhen(date, time) {
  if (!date) return time ? `время ${time.slice(0, 5)}, без даты` : 'без даты';
  const clock = time ? `, ${time.slice(0, 5)}` : '';
  if (date === state.today) return `сегодня${clock}`;
  if (date === addDays(state.today, 1)) return `завтра${clock}`;
  if (date === addDays(state.today, -1)) return `вчера${clock}`;
  const [, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS_SHORT[month - 1]}${clock}`;
}

const haptic = style => { try { tg?.HapticFeedback?.impactOccurred?.(style); } catch { /* not every client has it */ } };
const notify = type => { try { tg?.HapticFeedback?.notificationOccurred?.(type); } catch { /* as above */ } };

let toastTimer = null;
function toast(message, { tone = 'info', action = null, duration = 3200 } = {}) {
  const element = $('#toast');
  element.dataset.tone = tone;
  element.innerHTML = escapeHtml(message);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => { element.classList.remove('is-open'); action.run(); });
    element.append(button);
  }
  element.classList.add('is-open');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('is-open'), duration);
}

/** Guards an async action so a double tap runs it once. */
async function once(key, run) {
  if (state.busy.has(key)) return undefined;
  state.busy.add(key);
  try { return await run(); }
  finally { state.busy.delete(key); }
}

// --------------------------------------------------------------------- api --

function initData() {
  return tg?.initData || globalThis.TAVRO_INIT_DATA || '';
}

async function api(route, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Tavro-Init-Data': initData(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Нет связи с сервером. Проверьте интернет.');
  }
  let payload = null;
  try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const error = new Error(payload?.message || 'Не удалось выполнить запрос.');
    error.code = payload?.error || 'ERROR';
    error.status = response.status;
    throw error;
  }
  return payload;
}

// ------------------------------------------------------------------- views --

function setView(name) {
  state.view = name;
  for (const section of $$('.view')) section.classList.toggle('is-active', section.id === `view${name[0].toUpperCase()}${name.slice(1)}`);
  for (const button of $$('.tabbar button')) {
    if (button.dataset.view === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  // Telegram's own back button is the system back gesture on Android.
  if (name === 'today') tg?.BackButton?.hide?.();
  else tg?.BackButton?.show?.();
  if (name === 'calendar') renderCalendar();
  if (name === 'records') loadRecords();
  if (name === 'more') loadMore();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function rowMarkup(item, { kind = item.kind || 'task', done = false, action = '' } = {}) {
  const time = item.time || item.scheduled_time || item.event_time;
  return `
    <button class="row${done ? ' is-done' : ''}" type="button" data-id="${escapeHtml(item.id)}" data-kind="${escapeHtml(kind)}">
      ${kind === 'task' ? '<span class="row-check" aria-hidden="true"></span>' : `<span class="row-kind" data-kind="${escapeHtml(kind)}" aria-hidden="true"></span>`}
      <span class="row-body">
        <span class="row-title">${escapeHtml(item.title)}</span>
        <span class="row-meta">
          ${time ? `<span class="row-time">${escapeHtml(time.slice(0, 5))}</span>` : ''}
          <span>${escapeHtml(formatWhen(item.date ?? item.scheduled_for ?? item.event_date ?? null, time))}</span>
        </span>
      </span>
      <span class="row-action">${action}</span>
    </button>`;
}

const emptyMarkup = (title, hint) => `<div class="empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(hint)}</div>`;

// ------------------------------------------------------------------- today --

async function loadToday() {
  try {
    const data = await api('/today');
    state.today = data.today;
    state.profile = data.profile;
    state.data = { upcoming: data.upcoming, overdue: data.overdue, inbox: data.inbox, agenda: data.agenda };
    state.aiConfigured = data.aiConfigured;
    renderToday();
  } catch (error) {
    $('#todayNotice').innerHTML = `<div class="notice" data-tone="error">${escapeHtml(error.message)}</div>`;
    $('#todayUpcoming').innerHTML = '';
  }
}

function renderToday() {
  const [year, month, day] = state.today.split('-').map(Number);
  $('#todayDate').textContent = `${day} ${MONTHS[month - 1].toLowerCase()} ${year}`;

  const badge = $('#planBadge');
  badge.textContent = state.profile.pro ? 'PRO' : 'FREE';
  badge.dataset.pro = String(Boolean(state.profile.pro));

  const notices = [];
  if (state.profile.lapsed) notices.push('<div class="notice">Подписка закончилась. Все записи на месте, планер работает.</div>');
  if (state.aiConfigured === false) notices.push('<div class="notice" data-tone="error">ИИ ещё не подключён на сервере. Записи можно создавать вручную.</div>');
  $('#todayNotice').innerHTML = notices.join('');

  const upcoming = state.data.upcoming || [];
  $('#todayUpcoming').innerHTML = upcoming.length
    ? upcoming.map(item => rowMarkup(item, { kind: item.kind, action: item.kind === 'task' ? '' : '●' })).join('')
    : emptyMarkup('Пока пусто', 'Нажмите микрофон и скажите, что нужно сделать.');

  const overdue = state.data.overdue || [];
  $('#todayOverdueLabel').hidden = !overdue.length;
  $('#todayOverdue').innerHTML = overdue.map(item => rowMarkup({ ...item, date: item.scheduled_for }, { kind: 'task' })).join('');

  const inbox = state.data.inbox || [];
  $('#todayInboxLabel').hidden = !inbox.length;
  $('#todayInbox').innerHTML = inbox.map(item => rowMarkup(item, { kind: 'task' })).join('');
}

async function toggleTask(id, completed) {
  return once(`task:${id}`, async () => {
    haptic('light');
    try {
      await api('/task/complete', { method: 'POST', body: { taskId: id, completed } });
      notify('success');
      await loadToday();
      if (state.view === 'records') await loadRecords();
      if (state.view === 'calendar') await renderCalendar();
      if (completed) {
        toast('Выполнено', { action: { label: 'Отменить', run: () => toggleTask(id, false) } });
      }
    } catch (error) {
      notify('error');
      toast(error.message, { tone: 'error' });
    }
  });
}

// ---------------------------------------------------------------- calendar --

async function renderCalendar() {
  if (!state.today) return;
  const anchor = state.calendar.month || state.today.slice(0, 7);
  state.calendar.month = anchor;
  state.calendar.selected = state.calendar.selected || state.today;

  const [year, month] = anchor.split('-').map(Number);
  $('#calMonth').textContent = `${MONTHS[month - 1]} ${year}`;
  $('#calDow').innerHTML = DOW.map(name => `<div class="cal-dow">${name}</div>`).join('');

  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - lead * 86400000).toISOString().slice(0, 10);
  const end = addDays(start, 41);

  try {
    const data = await api(`/calendar?from=${start}&to=${end}`);
    state.calendar.tasks = data.tasks;
    state.calendar.events = data.events;
  } catch (error) {
    toast(error.message, { tone: 'error' });
  }

  const marked = new Set([
    ...state.calendar.tasks.map(task => task.scheduled_for),
    ...state.calendar.events.map(event => event.event_date),
  ]);

  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(start, index);
    const outside = date.slice(0, 7) !== anchor;
    cells.push(`<button class="cal-day" type="button" role="gridcell" data-date="${date}"
      data-outside="${outside}" data-today="${date === state.today}"
      aria-pressed="${date === state.calendar.selected}" aria-label="${date}">
      ${Number(date.slice(8))}
      ${marked.has(date) ? '<span class="cal-dot" aria-hidden="true"></span>' : ''}
    </button>`);
  }
  $('#calGrid').innerHTML = cells.join('');
  renderCalendarDay();
}

function renderCalendarDay() {
  const date = state.calendar.selected;
  $('#calDayLabel').textContent = formatWhen(date, null).replace(/^./, character => character.toUpperCase());
  const tasks = state.calendar.tasks.filter(task => task.scheduled_for === date);
  const events = state.calendar.events.filter(event => event.event_date === date);
  const markup = [
    ...events.map(event => rowMarkup({ ...event, date: event.event_date, time: event.event_time }, { kind: 'event' })),
    ...tasks.map(task => rowMarkup({ ...task, date: task.scheduled_for, time: task.scheduled_time }, { kind: 'task', done: task.completed })),
  ].join('');
  $('#calDayItems').innerHTML = markup || emptyMarkup('Свободный день', 'Ни задач, ни встреч.');
}

// ----------------------------------------------------------------- records --

async function loadRecords() {
  const tab = state.recordsTab;
  const container = $('#recordsList');
  container.setAttribute('aria-busy', 'true');
  try {
    if (tab === 'tasks') {
      const data = await api('/tasks');
      const rows = [...data.overdue, ...data.inbox];
      container.innerHTML = rows.length
        ? rows.map(task => rowMarkup({ ...task, date: task.scheduled_for, time: task.scheduled_time }, { kind: 'task' })).join('')
        : emptyMarkup('Задач нет', 'Скажите фразу — задача появится здесь.');
    } else {
      const data = await api(`/notes?kind=${tab}`);
      container.innerHTML = data.notes.length
        ? data.notes.map(note => `
          <div class="row" data-id="${escapeHtml(note.id)}" data-kind="note">
            <span class="row-kind" aria-hidden="true"></span>
            <span class="row-body">
              <span class="row-title">${escapeHtml(note.title)}</span>
              <span class="row-meta"><span>${escapeHtml(formatWhen(note.entry_date, null))}</span>${note.photo_file_id ? '<span>фото</span>' : ''}</span>
              ${note.body && note.body !== note.title ? `<span class="row-meta">${escapeHtml(note.body.slice(0, 160))}</span>` : ''}
              ${note.photo_summary ? `<span class="row-meta">≈ ${escapeHtml(note.photo_summary)} (приблизительно)</span>` : ''}
            </span>
            <span class="row-action"></span>
          </div>`).join('')
        : emptyMarkup('Записей нет', tab === 'meal' ? 'Пришлите фото еды в бот — оно попадёт сюда.' : 'Скажите «запиши…» — заметка появится здесь.');
    }
  } catch (error) {
    container.innerHTML = `<div class="notice" data-tone="error">${escapeHtml(error.message)}</div>`;
  } finally {
    container.removeAttribute('aria-busy');
  }
}

// -------------------------------------------------------------------- more --

async function loadMore() {
  if (state.moreTab === 'habits') return loadHabits();
  if (state.moreTab === 'progress') return loadProgress();
  return loadSettings();
}

async function loadHabits() {
  try {
    const data = await api('/habits');
    const entries = new Map(data.entries.map(entry => [`${entry.habit_id}:${entry.entry_date}`, entry.completed]));
    $('#habitsList').innerHTML = data.habits.length
      ? data.habits.map(habit => {
        const week = Array.from({ length: 7 }, (_, index) => {
          const date = addDays(state.today, index - 6);
          const done = entries.get(`${habit.id}:${date}`) === true;
          return `<button class="habit-day" type="button" data-habit="${escapeHtml(habit.id)}" data-date="${date}" data-done="${done}" aria-label="${escapeHtml(habit.title)} ${date}">${DOW[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]}</button>`;
        }).join('');
        return `<div style="padding:14px 4px;border-bottom:1px solid var(--line)">
          <div class="row-title">${escapeHtml(habit.title)}</div>
          <div class="habit-week">${week}</div>
        </div>`;
      }).join('')
      : emptyMarkup('Привычек нет', 'Скажите «каждый день читать» — привычка появится здесь.');
  } catch (error) {
    $('#habitsList').innerHTML = `<div class="notice" data-tone="error">${escapeHtml(error.message)}</div>`;
  }
}

async function loadProgress() {
  try {
    const data = await api('/progress');
    $('#progressDone').innerHTML = `${data.completed}<span>/${data.total}</span>`;
    $('#progressPercent').innerHTML = `${data.percent}<span>%</span>`;
    $('#progressMeter').style.width = `${data.percent}%`;
    $('#progressAi').textContent = `Тариф ${state.profile.planTitle}: ${state.profile.dailyAiActions} AI-действий в день. Одна фраза — одно действие, сколько бы записей она ни создала.`;
  } catch (error) {
    toast(error.message, { tone: 'error' });
  }
}

async function loadSettings() {
  try {
    const data = await api('/me');
    state.profile = data.profile;

    $('#remindersSwitch').setAttribute('aria-checked', String(Boolean(data.profile.remindersEnabled)));

    const select = $('#timezoneSelect');
    const zones = [...new Set([data.profile.timezone, ...TIMEZONES])];
    select.innerHTML = zones.map(zone => `<option value="${escapeHtml(zone)}"${zone === data.profile.timezone ? ' selected' : ''}>${escapeHtml(zone)}</option>`).join('');

    $('#plansList').innerHTML = data.plans.map(plan => {
      const current = plan.id === data.profile.plan;
      const renewal = plan.billing === 'subscription' ? 'автопродление каждые 30 дней'
        : plan.billing === 'one_time' ? 'разовая покупка' : 'бесплатно';
      const price = plan.rub === 0 ? '0 ₽' : `${plan.rub} ₽`;
      const buy = plan.id === 'free' || current ? ''
        : plan.available
          ? `<button class="btn btn-primary" type="button" data-buy="${escapeHtml(plan.id)}">Купить за ${plan.stars} ★</button>`
          : '<p class="plan-note">Цена в Stars пока не настроена на сервере.</p>';
      return `<div class="plan-card" data-current="${current}">
        <div class="plan-top"><span class="plan-name">${escapeHtml(plan.title)}${current ? ' · активен' : ''}</span><span class="plan-price">${price}</span></div>
        <p class="plan-note">${escapeHtml(renewal)} · ${escapeHtml(plan.summary)}</p>
        <p class="plan-note">${escapeHtml(plan.fairUse)}</p>
        ${buy}
      </div>`;
    }).join('');

    $('#quickTokens').innerHTML = data.quickTokens.length
      ? data.quickTokens.map(token => `<div class="setting">
          <div><div class="setting-label">${escapeHtml(token.label)}</div><div class="setting-hint">использован ${token.uses} раз</div></div>
          <button class="btn-quiet" type="button" data-revoke="${escapeHtml(token.id)}">Отозвать</button>
        </div>`).join('')
      : '';
  } catch (error) {
    toast(error.message, { tone: 'error' });
  }
}

// ------------------------------------------------------------------ capture --

const MIC_STATES = {
  idle: 'Нажмите и говорите',
  pressing: 'Отпустите, чтобы начать',
  recording: 'Идёт запись…',
  processing: 'Разбираю…',
  preview: 'Проверьте записи',
  saving: 'Сохраняю…',
  success: 'Сохранено',
  error: 'Не получилось',
};

function setMicState(name, hint) {
  $('#micButton').dataset.state = name;
  $('#micHint').textContent = hint || MIC_STATES[name] || '';
}

let recorder = null;
let recordedChunks = [];
let recordTimer = null;
let recordStarted = 0;

function openSheet(title, subtitle, html) {
  $('#sheetTitle').textContent = title;
  $('#sheetSub').textContent = subtitle;
  $('#sheetBody').innerHTML = html;
  $('#sheet').hidden = false;
  requestAnimationFrame(() => {
    $('#sheet').classList.add('is-open');
    $('#sheetBackdrop').classList.add('is-open');
  });
}

function closeSheet() {
  $('#sheet').classList.remove('is-open');
  $('#sheetBackdrop').classList.remove('is-open');
  setTimeout(() => { $('#sheet').hidden = true; }, 280);
  if (state.view === 'today') tg?.BackButton?.hide?.();
  setMicState('idle');
}

function composeMarkup(message = '') {
  return `
    ${message ? `<div class="notice" data-tone="error">${escapeHtml(message)}</div>` : ''}
    <div class="compose">
      <textarea id="composeText" placeholder="завтра встреча с Андреем в 15:00, потом изучить Python и оплатить интернет" aria-label="Фраза"></textarea>
      <button class="btn btn-primary" type="button" id="composeSend">Разобрать</button>
      <button class="btn-quiet" type="button" id="composeCancel">Отмена</button>
    </div>`;
}

function openCompose(message) {
  openSheet('Новая запись', 'Скажите или напишите одной фразой', composeMarkup(message));
  $('#composeText')?.focus();
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    // No microphone access in this client: the text path is always available.
    openCompose('Этот клиент Telegram не даёт доступ к микрофону. Напишите фразу текстом — разберу так же.');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    openCompose('Нет доступа к микрофону. Разрешите его в настройках или напишите текстом.');
    return;
  }

  recordedChunks = [];
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    .find(type => MediaRecorder.isTypeSupported?.(type)) || '';
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.addEventListener('dataavailable', event => { if (event.data.size) recordedChunks.push(event.data); });
  recorder.addEventListener('stop', () => {
    for (const track of stream.getTracks()) track.stop();
    void submitRecording(recorder?.mimeType || mimeType || 'audio/webm');
  });

  recordStarted = Date.now();
  recorder.start();
  setMicState('recording', '0:00 · нажмите, чтобы остановить');
  haptic('medium');

  recordTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - recordStarted) / 1000);
    setMicState('recording', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · нажмите, чтобы остановить`);
    if (seconds >= 120) stopRecording();
  }, 250);
}

function stopRecording() {
  clearInterval(recordTimer);
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  setMicState('processing');
}

async function submitRecording(mimeType) {
  const durationSeconds = Math.max(1, Math.round((Date.now() - recordStarted) / 1000));
  const blob = new Blob(recordedChunks, { type: mimeType });
  recordedChunks = [];
  if (blob.size < 1200) {
    setMicState('idle');
    toast('Слишком короткая запись', { tone: 'error' });
    return;
  }

  try {
    const audio = await blobToBase64(blob);
    const result = await api('/capture/voice', { method: 'POST', body: { audio, mimeType, durationSeconds } });
    showPreview(result);
  } catch (error) {
    setMicState('error');
    notify('error');
    // Speech can be unavailable while the rest of the product works; the text
    // path is offered rather than a dead end.
    openCompose(error.message);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Не удалось прочитать запись.'));
    reader.readAsDataURL(blob);
  });
}

async function submitPhrase(phrase) {
  if (!phrase.trim()) return;
  return once('capture', async () => {
    setMicState('processing');
    $('#composeSend') && ($('#composeSend').disabled = true);
    try {
      const result = await api('/capture', { method: 'POST', body: { phrase, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      showPreview(result);
    } catch (error) {
      setMicState('error');
      notify('error');
      openCompose(error.message);
    }
  });
}

function showPreview(result) {
  state.capture = { id: result.captureId, keep: new Set(result.preview.items.map((_, index) => index)), items: result.preview.items };
  setMicState('preview');
  notify('success');

  const items = result.preview.items.map((item, index) => `
    <button class="draft-item" type="button" data-draft="${index}" aria-pressed="true">
      <span class="draft-check" aria-hidden="true"></span>
      <span>
        <span class="draft-type">${escapeHtml(item.label)}</span>
        <span class="draft-title">${escapeHtml(item.title)}</span>
        <span class="draft-when" data-undated="${!item.date}">${escapeHtml(item.when)}${item.location ? ` · ${escapeHtml(item.location)}` : ''}${item.participants?.length ? ` · ${escapeHtml(item.participants.join(', '))}` : ''}</span>
      </span>
    </button>`).join('');

  const transcript = result.preview.transcript || result.transcript;
  openSheet(
    items ? `Нашёл ${result.preview.items.length}` : 'Ничего не разобрал',
    'Снимите галочку с лишнего и сохраните',
    `
      ${transcript ? `<div class="transcript">«${escapeHtml(transcript)}»</div>` : ''}
      ${result.preview.clarification ? `<div class="notice">${escapeHtml(result.preview.clarification.question)}</div>` : ''}
      ${items || emptyMarkup('Пусто', 'Попробуйте сказать конкретнее.')}
      <div class="sheet-actions">
        <button class="btn btn-primary" type="button" id="draftSave"${items ? '' : ' disabled'}>Сохранить</button>
        <button class="btn-quiet" type="button" id="draftDiscard">Отменить</button>
      </div>`,
  );
}

async function saveDraft() {
  if (!state.capture) return;
  return once('confirm', async () => {
    const button = $('#draftSave');
    if (button) { button.disabled = true; button.textContent = 'Сохраняю…'; }
    setMicState('saving');
    try {
      const result = await api('/capture/confirm', { method: 'POST', body: { captureId: state.capture.id, keep: [...state.capture.keep] } });
      setMicState('success');
      notify('success');
      closeSheet();
      toast(result.alreadySaved ? 'Уже сохранено' : `Сохранено: ${result.saved.length}`);
      state.capture = null;
      await loadToday();
      if (state.view !== 'today') setView('today');
    } catch (error) {
      setMicState('error');
      notify('error');
      toast(error.message, { tone: 'error' });
      if (button) { button.disabled = false; button.textContent = 'Сохранить'; }
    }
  });
}

// ----------------------------------------------------------------- binding --

function bind() {
  for (const button of $$('.tabbar button')) {
    button.addEventListener('click', () => { haptic('light'); setView(button.dataset.view); });
  }

  $('#micButton').addEventListener('click', () => {
    const current = $('#micButton').dataset.state;
    if (current === 'recording') return stopRecording();
    if (current === 'processing' || current === 'saving') return undefined;
    return startRecording();
  });

  // Long press opens the text path without a round trip through the microphone.
  let pressTimer = null;
  $('#micButton').addEventListener('pointerdown', () => {
    pressTimer = setTimeout(() => { haptic('heavy'); openCompose(); }, 600);
  });
  for (const event of ['pointerup', 'pointercancel', 'pointerleave']) {
    $('#micButton').addEventListener(event, () => clearTimeout(pressTimer));
  }

  $('#sheetBackdrop').addEventListener('click', () => { closeSheet(); void discardDraft(); });

  $('#sheetBody').addEventListener('click', async event => {
    const draft = event.target.closest('[data-draft]');
    if (draft) {
      const index = Number(draft.dataset.draft);
      const pressed = draft.getAttribute('aria-pressed') === 'true';
      draft.setAttribute('aria-pressed', String(!pressed));
      if (pressed) state.capture.keep.delete(index); else state.capture.keep.add(index);
      $('#draftSave').disabled = state.capture.keep.size === 0;
      haptic('light');
      return;
    }
    if (event.target.closest('#draftSave')) return void saveDraft();
    if (event.target.closest('#draftDiscard')) { closeSheet(); return void discardDraft(); }
    if (event.target.closest('#composeSend')) return void submitPhrase($('#composeText').value);
    if (event.target.closest('#composeCancel')) return closeSheet();
    return undefined;
  });

  $('#main').addEventListener('click', async event => {
    const row = event.target.closest('.row[data-kind="task"]');
    if (row) return void toggleTask(row.dataset.id, !row.classList.contains('is-done'));

    const day = event.target.closest('.cal-day');
    if (day) {
      state.calendar.selected = day.dataset.date;
      for (const cell of $$('.cal-day')) cell.setAttribute('aria-pressed', String(cell === day));
      renderCalendarDay();
      haptic('light');
      return undefined;
    }

    const habitDay = event.target.closest('.habit-day');
    if (habitDay) {
      return void once(`habit:${habitDay.dataset.habit}:${habitDay.dataset.date}`, async () => {
        try {
          const result = await api('/habit/toggle', { method: 'POST', body: { habitId: habitDay.dataset.habit, date: habitDay.dataset.date } });
          habitDay.dataset.done = String(Boolean(result.entry.completed));
          haptic('light');
        } catch (error) { toast(error.message, { tone: 'error' }); }
      });
    }

    const recordsTab = event.target.closest('[data-records-tab]');
    if (recordsTab) {
      state.recordsTab = recordsTab.dataset.recordsTab;
      for (const tab of $$('[data-records-tab]')) tab.setAttribute('aria-selected', String(tab === recordsTab));
      return void loadRecords();
    }

    const moreTab = event.target.closest('[data-more-tab]');
    if (moreTab) {
      state.moreTab = moreTab.dataset.moreTab;
      for (const tab of $$('[data-more-tab]')) tab.setAttribute('aria-selected', String(tab === moreTab));
      $('#paneHabits').hidden = state.moreTab !== 'habits';
      $('#paneProgress').hidden = state.moreTab !== 'progress';
      $('#paneSettings').hidden = state.moreTab !== 'settings';
      return void loadMore();
    }

    const buy = event.target.closest('[data-buy]');
    if (buy) return void purchase(buy.dataset.buy);

    const revoke = event.target.closest('[data-revoke]');
    if (revoke) {
      return void once(`revoke:${revoke.dataset.revoke}`, async () => {
        try { await api(`/quick-token/${revoke.dataset.revoke}`, { method: 'DELETE' }); toast('Токен отозван'); await loadSettings(); }
        catch (error) { toast(error.message, { tone: 'error' }); }
      });
    }

    if (event.target.closest('#remindersSwitch')) {
      const element = $('#remindersSwitch');
      const next = element.getAttribute('aria-checked') !== 'true';
      element.setAttribute('aria-checked', String(next));
      return void once('reminders', async () => {
        try { await api('/settings', { method: 'POST', body: { remindersEnabled: next } }); toast(next ? 'Напоминания включены' : 'Напоминания выключены'); }
        catch (error) { element.setAttribute('aria-checked', String(!next)); toast(error.message, { tone: 'error' }); }
      });
    }

    if (event.target.closest('#issueToken')) {
      return void once('issueToken', async () => {
        try {
          const issued = await api('/quick-token', { method: 'POST', body: { label: 'Быстрый ввод' } });
          openSheet('Токен быстрого ввода', 'Скопируйте его сейчас — второй раз он не показывается', `
            <div class="token-value">${escapeHtml(issued.token)}</div>
            <p class="plan-note">Вставьте его в Apple Shortcuts или ярлык Android как заголовок <code>Authorization: Bearer …</code> к адресу <code>${escapeHtml(API_BASE)}/quick/capture</code>. Токен умеет только создавать записи и его можно отозвать в любой момент.</p>
            <div class="sheet-actions"><button class="btn btn-primary" type="button" id="composeCancel">Готово</button></div>`);
          await loadSettings();
        } catch (error) { toast(error.message, { tone: 'error' }); }
      });
    }
    return undefined;
  });

  $('#timezoneSelect').addEventListener('change', event => {
    void once('timezone', async () => {
      try { await api('/settings', { method: 'POST', body: { timezone: event.target.value } }); toast('Часовой пояс сохранён'); await loadToday(); }
      catch (error) { toast(error.message, { tone: 'error' }); }
    });
  });

  $('#calPrev').addEventListener('click', () => shiftMonth(-1));
  $('#calNext').addEventListener('click', () => shiftMonth(1));
  $('#calToday').addEventListener('click', () => {
    state.calendar.month = state.today.slice(0, 7);
    state.calendar.selected = state.today;
    void renderCalendar();
  });

  tg?.BackButton?.onClick?.(() => {
    if (!$('#sheet').hidden) { closeSheet(); void discardDraft(); return; }
    setView('today');
  });

  // Returning from the background can mean another device changed something.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void loadToday(); });
}

function shiftMonth(delta) {
  const [year, month] = state.calendar.month.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  state.calendar.month = next.toISOString().slice(0, 7);
  void renderCalendar();
}

async function discardDraft() {
  if (!state.capture) return;
  const id = state.capture.id;
  state.capture = null;
  try { await api('/capture/discard', { method: 'POST', body: { captureId: id } }); } catch { /* the draft expires on its own */ }
}

async function purchase(plan) {
  return once(`buy:${plan}`, async () => {
    try {
      const invoice = await api('/invoice', { method: 'POST', body: { plan } });
      if (tg?.openInvoice) {
        tg.openInvoice(invoice.url, status => {
          if (status === 'paid') { toast('Оплачено. Обновляю доступ…'); setTimeout(() => void loadSettings(), 1500); }
          else if (status === 'failed') toast('Платёж не прошёл', { tone: 'error' });
        });
      } else if (tg?.openTelegramLink) {
        tg.openTelegramLink(invoice.url);
      } else {
        window.open(invoice.url, '_blank', 'noopener');
      }
    } catch (error) {
      toast(error.message, { tone: 'error' });
    }
  });
}

// -------------------------------------------------------------------- boot --

async function boot() {
  try { tg?.ready?.(); tg?.expand?.(); tg?.setHeaderColor?.('#080809'); tg?.setBackgroundColor?.('#080809'); } catch { /* older clients */ }
  bind();
  setMicState('idle');
  await loadToday();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot());
else void boot();

export { formatWhen, escapeHtml, state };
