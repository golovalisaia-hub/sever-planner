(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const DENSITY_KEY = 'sever-density';
  const DENSITIES = new Set(['auto', 'comfortable', 'compact']);
  let bootAttempts = 0;
  let bootTimer = 0;

  function interactiveTarget(target) {
    return Boolean(target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],[role="textbox"]'));
  }

  function openQuickAdd() {
    if (document.querySelector('dialog[open]')) return false;
    const desktop = $('#globalAddBtn');
    const mobile = $('#mobileCreateBtn');
    const trigger = desktop && getComputedStyle(desktop).display !== 'none' ? desktop : mobile;
    if (!trigger) return false;
    trigger.click();
    requestAnimationFrame(() => {
      const input = $('#quickCaptureInput');
      if (input && !input.disabled) {
        input.focus({ preventScroll: true });
        input.select?.();
      }
    });
    return true;
  }

  function go(view) {
    window.SeverApp?.switchView?.(view);
  }

  function goInbox() {
    go('calendar');
    requestAnimationFrame(() => $('.sever2-calendar-modes [data-mode="inbox"]')?.click());
  }

  function openAI() {
    $('#severAiOpen')?.click();
  }

  function commands() {
    return [
      { id: 'new-task', label: 'Новая задача', hint: 'Q', keywords: 'создать добавить дело задача', run: openQuickAdd },
      { id: 'today', label: 'Сегодня', hint: 'Главная', keywords: 'сегодня главная дела', run: () => go('today') },
      { id: 'calendar', label: 'Календарь', hint: 'План', keywords: 'календарь день месяц план', run: () => go('calendar') },
      { id: 'inbox', label: 'Входящие', hint: 'Без даты', keywords: 'входящие inbox без даты', run: goInbox },
      { id: 'focus', label: 'Фокус', hint: 'Alt+F', keywords: 'фокус таймер focus работа', run: () => go('timer') },
      { id: 'notes', label: 'Заметки', hint: '', keywords: 'заметки запись note', run: () => go('notes') },
      { id: 'ai', label: 'Sever AI', hint: '', keywords: 'ии ai помощник', run: openAI },
      { id: 'settings', label: 'Настройки', hint: '', keywords: 'настройки тема оформление плотность', run: () => go('settings') }
    ];
  }

  function ensureCommandDialog() {
    let dialog = $('#sever2CommandDialog');
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.id = 'sever2CommandDialog';
    dialog.className = 'sever2-command-dialog';
    dialog.innerHTML = `
      <div class="sever2-command-shell">
        <header class="sever2-command-head">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
          <input id="sever2CommandInput" type="search" autocomplete="off" spellcheck="false" placeholder="Куда перейти или что сделать?" aria-label="Быстрые команды SEVER">
          <kbd>Esc</kbd>
        </header>
        <div id="sever2CommandList" class="sever2-command-list" role="listbox" aria-label="Команды"></div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> выбрать</span><span><kbd>Enter</kbd> выполнить</span></footer>
      </div>`;
    document.body.appendChild(dialog);

    const input = $('#sever2CommandInput');
    const list = $('#sever2CommandList');
    let active = 0;
    let visible = [];

    function render() {
      const query = input.value.trim().toLocaleLowerCase('ru-RU');
      visible = commands().filter(command => `${command.label} ${command.keywords}`.toLocaleLowerCase('ru-RU').includes(query));
      active = Math.min(active, Math.max(0, visible.length - 1));
      list.replaceChildren();
      if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'sever2-command-empty';
        empty.textContent = 'Ничего не найдено';
        list.appendChild(empty);
        return;
      }
      visible.forEach((command, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = index === active ? 'active' : '';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(index === active));
        button.dataset.commandId = command.id;
        const label = document.createElement('span');
        label.textContent = command.label;
        const hint = document.createElement('small');
        hint.textContent = command.hint;
        button.append(label, hint);
        button.addEventListener('mousemove', () => { active = index; render(); });
        button.addEventListener('click', () => execute(index));
        list.appendChild(button);
      });
    }

    function execute(index = active) {
      const command = visible[index];
      if (!command) return;
      dialog.close();
      command.run();
    }

    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        active = Math.min(active + 1, visible.length - 1);
        render();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        active = Math.max(active - 1, 0);
        render();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        execute();
      }
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => { input.value = ''; active = 0; render(); });
    render();
    return dialog;
  }

  function openCommandCenter() {
    if (document.querySelector('dialog[open]:not(#sever2CommandDialog)')) return;
    const dialog = ensureCommandDialog();
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => $('#sever2CommandInput')?.focus({ preventScroll: true }));
  }

  function applyDensity(value) {
    const density = DENSITIES.has(value) ? value : 'auto';
    document.documentElement.dataset.density = density;
    try { localStorage.setItem(DENSITY_KEY, density); } catch {}
    $$('.sever2-density-choice').forEach(button => {
      const active = button.dataset.density === density;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
    return density;
  }

  function installDensitySetting() {
    if ($('#sever2DensitySetting')) return;
    const host = $('#settingsView .settings-appearance') || $('#settingsView');
    if (!host) return;

    const section = document.createElement('section');
    section.id = 'sever2DensitySetting';
    section.className = 'settings-section sever2-density-setting';
    section.innerHTML = `
      <div class="sever2-density-copy">
        <small>ИНТЕРФЕЙС</small>
        <b>Плотность</b>
        <span>На телефоне SEVER всегда оставляет удобные зоны нажатия. На ПК можно сделать интерфейс плотнее.</span>
      </div>
      <div class="sever2-density-options" role="radiogroup" aria-label="Плотность интерфейса">
        <button type="button" class="sever2-density-choice" data-density="auto" role="radio"><b>Авто</b><small>Рекомендуется</small></button>
        <button type="button" class="sever2-density-choice" data-density="comfortable" role="radio"><b>Комфортно</b><small>Больше воздуха</small></button>
        <button type="button" class="sever2-density-choice" data-density="compact" role="radio"><b>Компактно</b><small>Больше дел на экране</small></button>
      </div>`;
    host.appendChild(section);
    section.querySelectorAll('[data-density]').forEach(button => {
      button.addEventListener('click', () => applyDensity(button.dataset.density));
    });
    let saved = 'auto';
    try { saved = localStorage.getItem(DENSITY_KEY) || 'auto'; } catch {}
    applyDensity(saved);
  }

  function installDesktopCommandButton() {
    if ($('#sever2CommandOpen')) return;
    const topbar = $('.topbar');
    if (!topbar) return;
    const button = document.createElement('button');
    button.id = 'sever2CommandOpen';
    button.type = 'button';
    button.className = 'sever2-command-open';
    button.setAttribute('aria-label', 'Быстрые команды');
    button.title = 'Быстрые команды · /';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><span>Команды</span><kbd>/</kbd>';
    button.addEventListener('click', openCommandCenter);
    topbar.appendChild(button);
  }

  function installKeyboard() {
    if (document.documentElement.dataset.severEfficiencyKeyboard === 'ready') return;
    document.documentElement.dataset.severEfficiencyKeyboard = 'ready';
    document.addEventListener('keydown', event => {
      const key = event.key.toLowerCase();
      /* Ctrl/Cmd+K is kept as a best-effort accelerator in installed PWAs,
         but browsers often reserve it for the address bar. Slash is the
         dependable in-page shortcut and is what the UI advertises. */
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        openCommandCenter();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === '/' && !interactiveTarget(event.target) && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        openCommandCenter();
        return;
      }
      if (event.altKey && key === 'f') return;
      if (!event.ctrlKey && !event.metaKey && !event.altKey && key === 'q' && !interactiveTarget(event.target) && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        openQuickAdd();
      }
    });
  }

  function installQuickAddFocus() {
    ['#globalAddBtn', '#mobileCreateBtn'].forEach(selector => {
      const button = $(selector);
      if (!button || button.dataset.severAutofocus === 'true') return;
      button.dataset.severAutofocus = 'true';
      button.addEventListener('click', () => requestAnimationFrame(() => $('#quickCaptureInput')?.focus({ preventScroll: true })));
    });
  }

  function handleLaunchIntent() {
    if (document.documentElement.dataset.severLaunchIntentHandled === 'true') return;
    const params = new URLSearchParams(location.search);
    const action = params.get('action');
    const view = params.get('view');
    if (!action && !view) return;
    document.documentElement.dataset.severLaunchIntentHandled = 'true';
    requestAnimationFrame(() => {
      if (action === 'new-task') openQuickAdd();
      else if (view === 'inbox') goInbox();
      else if (['today', 'calendar', 'timer', 'notes', 'settings'].includes(view)) go(view);
      const clean = `${location.pathname}${location.hash || ''}`;
      history.replaceState(null, '', clean);
    });
  }

  function boot() {
    if (!window.SeverApp?.switchView) return false;
    ensureCommandDialog();
    installKeyboard();
    installQuickAddFocus();
    installDesktopCommandButton();
    installDensitySetting();
    handleLaunchIntent();
    document.documentElement.dataset.severEfficiency = 'ready';
    return true;
  }

  function scheduleBoot() {
    if (boot()) {
      clearTimeout(bootTimer);
      return;
    }
    if (bootAttempts++ >= 160) return;
    clearTimeout(bootTimer);
    bootTimer = setTimeout(scheduleBoot, 50);
  }

  let savedDensity = 'auto';
  try { savedDensity = localStorage.getItem(DENSITY_KEY) || 'auto'; } catch {}
  document.documentElement.dataset.density = DENSITIES.has(savedDensity) ? savedDensity : 'auto';

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, { once: true });
  window.addEventListener('sever:ready', scheduleBoot);
})();
