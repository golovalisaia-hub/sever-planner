(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const MODES = Object.freeze({ FLEXIBLE: 'flexible', FOCUS: 'focus', SCHEDULED: 'scheduled' });
  let activeTaskId = '';
  let detailedMode = MODES.FLEXIBLE;
  let quickMode = MODES.FLEXIBLE;
  let initialized = false;
  let renderQueued = false;

  const state = () => window.SeverApp?.getState?.() || { tasks: [] };
  const taskById = id => state().tasks.find(task => String(task.id) === String(id));

  function modeFor(task) {
    if (!task) return MODES.FLEXIBLE;
    if (task.time) return MODES.SCHEDULED;
    if (Number(task.duration) > 0) return MODES.FOCUS;
    if (task.category === 'Учёба') return MODES.FOCUS;
    if (task.category === 'Дела') return MODES.SCHEDULED;
    return MODES.FLEXIBLE;
  }

  function modeLabel(mode) {
    if (mode === MODES.FOCUS) return 'Фокус';
    if (mode === MODES.SCHEDULED) return 'По времени';
    return 'Гибко';
  }

  function friendlyMeta(task) {
    const mode = modeFor(task);
    const parts = [];
    if (task.priority) parts.push('Важное');
    if (mode === MODES.FOCUS) {
      parts.push('Фокус');
      parts.push(`${Number(task.duration) || 30} мин`);
    } else if (mode === MODES.SCHEDULED) {
      parts.push(task.time ? `В ${task.time}` : 'По времени');
    } else parts.push('Гибко');
    if (task.category) parts.push(task.category);
    return parts.join(' · ');
  }

  function legacyMeta(task) {
    const duration = (task.time ? `${task.time} · ` : '') + (task.duration ? `${task.duration} мин` : 'Без времени');
    return `${duration} · ${task.category || 'Личное'}`;
  }

  function resolveRowTask(row, used = new Set()) {
    const existing = row.dataset.taskId;
    if (existing && taskById(existing)) return taskById(existing);
    const title = (row.querySelector('.task-name')?.textContent || '').replace('★', '').trim();
    const meta = row.querySelector('.task-meta')?.textContent?.trim() || '';
    let candidates = state().tasks.filter(task => !used.has(String(task.id)) && String(task.title || '').trim() === title && Boolean(task.completed) === row.classList.contains('done'));
    if (!candidates.length) candidates = state().tasks.filter(task => !used.has(String(task.id)) && String(task.title || '').trim() === title);
    if (candidates.length > 1) {
      const exact = candidates.find(task => meta === legacyMeta(task) || meta === friendlyMeta(task));
      if (exact) return exact;
      const scored = candidates.map(task => {
        let score = 0;
        if (task.category && meta.includes(task.category)) score += 4;
        if (task.time && meta.includes(task.time)) score += 3;
        if (task.duration && meta.includes(String(task.duration))) score += 2;
        return { task, score };
      }).sort((a, b) => b.score - a.score);
      return scored[0]?.task || null;
    }
    return candidates[0] || null;
  }

  function decorateTaskRows() {
    $$('.task-list').forEach(list => {
      const used = new Set();
      list.querySelectorAll('.task').forEach(row => {
        const task = resolveRowTask(row, used);
        if (!task) return;
        row.dataset.taskId = String(task.id);
        row.dataset.executionMode = modeFor(task);
        used.add(String(task.id));
        const meta = row.querySelector('.task-meta');
        if (meta) meta.textContent = friendlyMeta(task);
      });
    });
  }

  function addErrandsOption() {
    const select = $('#taskCategory');
    if (!select || [...select.options].some(option => option.value === 'Дела')) return;
    const option = document.createElement('option');
    option.value = option.textContent = 'Дела';
    const work = [...select.options].find(item => item.value === 'Работа');
    if (work) select.insertBefore(option, work);
    else select.appendChild(option);
  }

  function ensureDetailedModeUi() {
    const form = $('#taskForm');
    const category = $('#taskCategory');
    if (!form || !category) return;
    addErrandsOption();
    const categoryLabel = category.closest('label');
    const dateRow = $('#taskDate')?.closest('.form-row');
    if (categoryLabel && dateRow && categoryLabel.parentElement === form && dateRow.parentElement === form && categoryLabel.nextElementSibling !== dateRow) form.insertBefore(categoryLabel, dateRow);
    if ($('#severTaskModeField')) return;
    const field = document.createElement('fieldset');
    field.id = 'severTaskModeField';
    field.className = 'sever-execution-field';
    field.innerHTML = `<legend>Как выполнить</legend><div class="sever-execution-options" role="group" aria-label="Формат задачи"><button type="button" data-task-mode="flexible"><b>Гибко</b><small>Без времени</small></button><button type="button" data-task-mode="focus"><b>Фокус</b><small>С таймером</small></button><button type="button" data-task-mode="scheduled"><b>По времени</b><small>К определённому часу</small></button></div><p id="severTaskModeHint" class="sever-execution-hint"></p>`;
    categoryLabel?.insertAdjacentElement('afterend', field);
    field.querySelectorAll('[data-task-mode]').forEach(button => button.addEventListener('click', () => setDetailedMode(button.dataset.taskMode, { preserve: false })));
  }

  function setDetailedMode(mode, { preserve = false } = {}) {
    if (!Object.values(MODES).includes(mode)) mode = MODES.FLEXIBLE;
    detailedMode = mode;
    const form = $('#taskForm');
    if (form) form.dataset.severExecutionMode = mode;
    $$('#severTaskModeField [data-task-mode]').forEach(button => {
      const active = button.dataset.taskMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const time = $('#taskTime');
    const timeLabel = time?.closest('label');
    const duration = $('#taskDuration');
    const durationField = duration?.closest('.duration-field');
    timeLabel?.classList.toggle('sever-field-hidden', mode !== MODES.SCHEDULED);
    durationField?.classList.toggle('sever-field-hidden', mode !== MODES.FOCUS);
    if (time) time.required = mode === MODES.SCHEDULED;
    if (!preserve) {
      if (mode === MODES.FOCUS) {
        if (time) time.value = '';
        if (duration && !Number(duration.value)) { duration.value = '30'; duration.dispatchEvent(new Event('input', { bubbles: true })); }
      } else if (mode === MODES.SCHEDULED) {
        if (duration) { duration.value = ''; duration.dispatchEvent(new Event('input', { bubbles: true })); }
      } else {
        if (time) time.value = '';
        if (duration) { duration.value = ''; duration.dispatchEvent(new Event('input', { bubbles: true })); }
      }
    }
    const hint = $('#severTaskModeHint');
    if (hint) hint.textContent = mode === MODES.FOCUS
      ? 'Таймер будет привязан к задаче. Для учёбы это основной режим.'
      : mode === MODES.SCHEDULED
        ? 'Укажите время начала. Таймер не запускается — это дело, которое нужно сделать к определённому часу.'
        : 'Без обязательного времени и таймера. Подходит для обычных задач.';
  }

  function syncDetailedDialog() {
    ensureDetailedModeUi();
    const id = $('#taskId')?.value || '';
    const task = id ? taskById(id) : null;
    const category = $('#taskCategory');
    if (task?.category && category && ![...category.options].some(option => option.value === task.category)) {
      const option = document.createElement('option'); option.value = option.textContent = task.category; category.appendChild(option);
    }
    if (task?.category && category) category.value = task.category;
    setDetailedMode(task ? modeFor(task) : (category?.value === 'Учёба' ? MODES.FOCUS : category?.value === 'Дела' ? MODES.SCHEDULED : MODES.FLEXIBLE), { preserve: Boolean(task) });
  }

  function ensureQuickModeUi() {
    const form = $('#quickCaptureForm');
    const chips = form?.querySelector('.quick-date-chips');
    if (!form || !chips || $('#severQuickModeField')) return;
    const field = document.createElement('fieldset');
    field.id = 'severQuickModeField';
    field.className = 'sever-quick-mode';
    field.innerHTML = `<legend>Как выполнить</legend><div class="sever-quick-mode-options"><button type="button" data-quick-mode="flexible">Просто</button><button type="button" data-quick-mode="focus">Фокус</button><button type="button" data-quick-mode="scheduled">По времени</button></div><div id="severQuickFocusDetails" class="sever-quick-mode-details"><label>Таймер<select id="severQuickFocusMinutes" aria-label="Длительность фокуса"><option value="15">15 мин</option><option value="25">25 мин</option><option value="30" selected>30 мин</option><option value="45">45 мин</option><option value="60">60 мин</option></select></label></div><div id="severQuickScheduleDetails" class="sever-quick-mode-details"><label>Время<input id="severQuickTime" type="time" aria-label="Время задачи"></label></div>`;
    chips.insertAdjacentElement('afterend', field);
    field.querySelectorAll('[data-quick-mode]').forEach(button => button.addEventListener('click', () => setQuickMode(button.dataset.quickMode)));
    setQuickMode(MODES.FLEXIBLE);
  }

  function setQuickMode(mode) {
    if (!Object.values(MODES).includes(mode)) mode = MODES.FLEXIBLE;
    quickMode = mode;
    const form = $('#quickCaptureForm');
    if (form) form.dataset.severQuickMode = mode;
    $$('#severQuickModeField [data-quick-mode]').forEach(button => {
      const active = button.dataset.quickMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('#severQuickFocusDetails')?.classList.toggle('active', mode === MODES.FOCUS);
    $('#severQuickScheduleDetails')?.classList.toggle('active', mode === MODES.SCHEDULED);
    const time = $('#severQuickTime');
    if (time) time.required = mode === MODES.SCHEDULED;
  }

  async function persistTaskFlowMutation() {
    try { window.SeverApp?.beforeLocalSave?.(); } catch {}
    await window.SeverApp?.persist?.();
    window.SeverApp?.render?.();
    queueRender();
  }

  function installQuickSubmitHook() {
    const form = $('#quickCaptureForm');
    if (!form || form.dataset.severTaskFlowSubmit === 'ready') return;
    form.dataset.severTaskFlowSubmit = 'ready';
    form.addEventListener('submit', event => {
      const mode = quickMode;
      const time = $('#severQuickTime')?.value || '';
      if (mode === MODES.SCHEDULED && !time) {
        event.preventDefault();
        event.stopImmediatePropagation();
        $('#severQuickTime')?.reportValidity?.();
        return;
      }
      const before = new Set(state().tasks.map(task => String(task.id)));
      const duration = Number($('#severQuickFocusMinutes')?.value) || 30;
      queueMicrotask(async () => {
        const created = state().tasks.find(task => !before.has(String(task.id)));
        if (!created) return;
        if (mode === MODES.FOCUS) {
          created.time = '';
          created.duration = Number(created.duration) || duration;
        } else if (mode === MODES.SCHEDULED) {
          created.time = time;
          created.duration = null;
        } else {
          created.time = '';
          created.duration = null;
        }
        created.updatedAt = Date.now();
        await persistTaskFlowMutation();
      });
    }, true);
  }

  function captureTaskClicks(event) {
    const row = event.target.closest?.('[data-task-id]');
    if (row?.dataset.taskId) activeTaskId = row.dataset.taskId;
  }

  function openTaskActionFor(task) {
    if (!task) return;
    decorateTaskRows();
    activeTaskId = String(task.id);
    const row = $(`.task[data-task-id="${CSS.escape(String(task.id))}"]`);
    row?.querySelector('.task-open,.edit')?.click();
  }

  async function completeTask(task) {
    if (!task) return;
    decorateTaskRows();
    const row = $(`.task[data-task-id="${CSS.escape(String(task.id))}"]`);
    const check = row?.querySelector('.check');
    if (check) { check.click(); return; }
    task.completed = true;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();
    await persistTaskFlowMutation();
  }

  function resolveActionTask() {
    const direct = taskById(activeTaskId);
    if (direct) return direct;
    const title = $('#taskActionTitle')?.textContent?.trim() || '';
    const category = ($('#taskActionCategory')?.textContent || '').toLocaleLowerCase('ru-RU');
    const candidates = state().tasks.filter(task => String(task.title || '').trim() === title);
    return candidates.find(task => category.includes(String(task.category || '').toLocaleLowerCase('ru-RU'))) || candidates[0] || null;
  }

  function patchActionDialog() {
    const dialog = $('#taskActionDialog');
    if (!dialog?.open) return;
    const task = resolveActionTask();
    if (!task) return;
    activeTaskId = String(task.id);
    const mode = modeFor(task);
    dialog.dataset.executionMode = mode;
    const start = $('#taskActionStart');
    const complete = $('#taskActionComplete');
    const hint = $('#taskActionHint');
    const meta = $('#taskActionMeta');
    if (meta) meta.textContent = [task.time ? `В ${task.time}` : '', task.duration ? `${task.duration} мин` : '', task.category || ''].filter(Boolean).join(' · ') || 'Без фиксированного времени';
    if (task.completed) return;
    if (mode === MODES.FOCUS) {
      if (start) start.textContent = 'Начать фокус';
      complete?.classList.remove('hidden');
      if (hint) hint.textContent = `Таймер привязан к этой задаче${task.duration ? ` на ${task.duration} мин` : ''}.`;
    } else {
      if (start) start.textContent = 'Готово';
      complete?.classList.add('hidden');
      if (hint) hint.textContent = mode === MODES.SCHEDULED
        ? `Запланировано${task.time ? ` на ${task.time}` : ''}. Таймер не нужен — отметьте дело, когда оно выполнено.`
        : 'Без фиксированного времени и таймера. Формат можно изменить в настройках задачи.';
    }
  }

  function installActionHook() {
    const button = $('#taskActionStart');
    if (!button || button.dataset.severTaskFlowClick === 'ready') return;
    button.dataset.severTaskFlowClick = 'ready';
    button.addEventListener('click', event => {
      const task = resolveActionTask();
      if (!task || task.completed || modeFor(task) === MODES.FOCUS) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      $('#taskActionDialog')?.close();
      completeTask(task);
    }, true);
  }

  function patchHomeRows() {
    $$('#sever2HomeTopTasks .sever2-home-focus-task[data-task-id]').forEach(row => {
      const task = taskById(row.dataset.taskId);
      if (!task) return;
      const mode = modeFor(task);
      row.dataset.executionMode = mode;
      const meta = row.querySelector('.sever2-home-focus-copy small');
      if (meta) meta.textContent = friendlyMeta(task);
      const action = row.querySelector('.sever2-home-focus-start');
      if (!action) return;
      action.dataset.executionMode = mode;
      action.classList.toggle('is-scheduled', mode === MODES.SCHEDULED);
      action.classList.toggle('is-flexible', mode === MODES.FLEXIBLE);
      if (mode === MODES.FOCUS) {
        action.setAttribute('aria-label', 'Начать фокус');
        action.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5Z"/></svg>';
      } else if (mode === MODES.SCHEDULED) {
        action.setAttribute('aria-label', task.time ? `Открыть задачу на ${task.time}` : 'Открыть задачу по времени');
        action.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>';
      } else {
        action.setAttribute('aria-label', 'Открыть задачу');
        action.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
      }
      if (action.dataset.severTaskFlowBound !== 'true') {
        action.dataset.severTaskFlowBound = 'true';
        action.addEventListener('click', event => {
          const current = taskById(row.dataset.taskId);
          if (!current || modeFor(current) === MODES.FOCUS) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          openTaskActionFor(current);
        }, true);
      }
    });
  }

  function renderTaskPresentation() {
    renderQueued = false;
    decorateTaskRows();
    patchHomeRows();
    patchActionDialog();
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(renderTaskPresentation);
  }

  function installObservers() {
    const main = document.querySelector('main');
    if (main && main.dataset.severTaskFlowObserver !== 'ready') {
      main.dataset.severTaskFlowObserver = 'ready';
      new MutationObserver(queueRender).observe(main, { childList: true, subtree: true });
    }
    const taskDialog = $('#taskDialog');
    if (taskDialog && taskDialog.dataset.severTaskFlowObserver !== 'ready') {
      taskDialog.dataset.severTaskFlowObserver = 'ready';
      new MutationObserver(() => { if (taskDialog.open) requestAnimationFrame(syncDetailedDialog); }).observe(taskDialog, { attributes: true, attributeFilter: ['open'] });
    }
    const quick = $('#quickAddDialog');
    if (quick && quick.dataset.severTaskFlowObserver !== 'ready') {
      quick.dataset.severTaskFlowObserver = 'ready';
      new MutationObserver(() => { if (quick.open) { setQuickMode(MODES.FLEXIBLE); const time = $('#severQuickTime'); if (time) time.value = ''; const duration = $('#severQuickFocusMinutes'); if (duration) duration.value = '30'; } }).observe(quick, { attributes: true, attributeFilter: ['open'] });
    }
    const action = $('#taskActionDialog');
    if (action && action.dataset.severTaskFlowObserver !== 'ready') {
      action.dataset.severTaskFlowObserver = 'ready';
      new MutationObserver(() => { if (action.open) requestAnimationFrame(patchActionDialog); }).observe(action, { attributes: true, attributeFilter: ['open'] });
    }
  }

  function setup() {
    if (initialized || !window.SeverApp || !$('#taskForm')) return false;
    initialized = true;
    ensureDetailedModeUi();
    ensureQuickModeUi();
    installQuickSubmitHook();
    installActionHook();
    installObservers();
    document.addEventListener('click', captureTaskClicks, true);
    $('#taskCategory')?.addEventListener('change', event => {
      if (event.target.value === 'Учёба') setDetailedMode(MODES.FOCUS, { preserve: false });
      else if (event.target.value === 'Дела') setDetailedMode(MODES.SCHEDULED, { preserve: false });
    });
    window.addEventListener('sever:ready', queueRender);
    window.addEventListener('sever:cloud-status', queueRender);
    queueRender();
    document.documentElement.dataset.severTaskFlow = 'ready';
    window.SeverTaskFlow = Object.freeze({ modeFor, modeLabel, friendlyMeta, setDetailedMode, setQuickMode });
    return true;
  }

  let attempts = 0;
  const boot = () => { if (setup()) return; if (attempts++ < 160) setTimeout(boot, 50); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
