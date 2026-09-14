(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const state = () => window.SeverApp?.getState?.() || null;
  const V110_SLIDES = [
    {
      title: 'Добро пожаловать в SEVER',
      text: 'Здесь не нужно настраивать всё сразу. Чтобы начать, достаточно одного дела на сегодня.',
      view: 'today',
      target: null
    },
    {
      title: 'Главная — это сегодняшний день',
      text: 'Здесь остаётся только то, что важно сейчас: задачи, прогресс дня и быстрый путь к фокусу.',
      view: 'today',
      target: 'today'
    },
    {
      title: 'Добавь одно дело',
      text: 'Нажми «+» или введи задачу на Главной. Не нужно заполнять всё идеально — название уже достаточно.',
      view: 'today',
      target: 'create'
    },
    {
      title: 'Когда пора делать — включи фокус',
      text: 'Открой задачу и запусти таймер. SEVER свяжет фокус с делом и поможет спокойно довести его до конца.',
      view: 'timer',
      target: 'timer'
    },
    {
      title: 'Всё под рукой',
      text: 'Остальное — по мере надобности: Календарь хранит планы и историю, Заметки — мысли и чек-листы, Привычки и Прогресс показывают ритм, Финансы помогают держать бюджет, расходы и цели рядом. Это знакомство всегда можно открыть снова в Настройках.',
      view: 'today',
      target: null
    }
  ];

  const EMPTY_TODAY_COPY = 'Начни с одного дела. После создания открой задачу — там можно запустить фокус и спокойно довести её до конца.';
  const EMPTY_TODAY_ACTION = '＋ Добавить первую задачу';
  let installed = false;
  let guideObserver = null;
  let todayObserver = null;
  let finalActionArmed = false;
  let dayRefreshTimer = 0;
  let dayRefreshFrame = 0;

  function replaceCoreSlides() {
    try {
      if (typeof tourSlides === 'undefined' || !Array.isArray(tourSlides)) return false;
      tourSlides.splice(0, tourSlides.length, ...V110_SLIDES.map(slide => ({ ...slide })));
      return true;
    } catch {
      return false;
    }
  }

  function ensureStepCounter() {
    const head = $('#tourDialog .guide-card-head');
    const kicker = head?.querySelector('.guide-kicker');
    if (!head || !kicker) return null;
    if (kicker.textContent !== 'БЫСТРОЕ ЗНАКОМСТВО') kicker.textContent = 'БЫСТРОЕ ЗНАКОМСТВО';
    let counter = $('#sever110GuideStep');
    if (!counter) {
      counter = document.createElement('span');
      counter.id = 'sever110GuideStep';
      counter.className = 'sever110-guide-step';
      kicker.after(counter);
    }
    return counter;
  }

  function guideStep() {
    const raw = Number($('#tourDialog')?.dataset.step || 1);
    if (!Number.isFinite(raw)) return 1;
    return Math.max(1, Math.min(V110_SLIDES.length, raw));
  }

  function isLastStep() {
    return guideStep() === V110_SLIDES.length;
  }

  function hasAnyTasks() {
    return Boolean(state()?.tasks?.length);
  }

  function syncGuideSlideCopy() {
    const dialog = $('#tourDialog');
    if (!dialog?.open) return;
    const slide = V110_SLIDES[guideStep() - 1];
    const title = $('#tourTitle');
    const copy = $('#tourText');
    if (title && title.textContent !== slide.title) title.textContent = slide.title;
    if (copy && copy.textContent !== slide.text) copy.textContent = slide.text;
  }

  function syncGuideSpotlight() {
    const dialog = $('#tourDialog');
    const spot = $('#guideSpotlight');
    if (!dialog?.open || !spot) return;
    const slide = V110_SLIDES[guideStep() - 1];
    if (slide?.target) return;
    if (dialog.dataset.hasTarget !== 'false') dialog.dataset.hasTarget = 'false';
    if (spot.hasAttribute('style')) spot.removeAttribute('style');
  }

  function syncGuideChrome() {
    const dialog = $('#tourDialog');
    if (!dialog) return;
    syncGuideSlideCopy();
    syncGuideSpotlight();
    const counter = ensureStepCounter();
    const counterText = `${guideStep()} / ${V110_SLIDES.length}`;
    if (counter && counter.textContent !== counterText) counter.textContent = counterText;
    const next = $('#tourNext');
    const nextText = isLastStep()
      ? (hasAnyTasks() ? 'Готово' : 'Добавить первую задачу')
      : 'Далее';
    if (next && next.textContent !== nextText) next.textContent = nextText;
    const skip = $('#tourSkip');
    const skipText = state()?.onboarded ? 'Закрыть' : 'Пропустить';
    if (skip && skip.textContent !== skipText) skip.textContent = skipText;
  }

  function focusTaskTitle() {
    const input = $('#taskTitle');
    if (!input || !$('#taskDialog')?.open) return;
    try { input.focus({ preventScroll: true }); }
    catch { input.focus(); }
  }

  function openFirstTask() {
    if (hasAnyTasks()) return;
    try {
      if (typeof openTask === 'function') {
        openTask();
        focusTaskTitle();
        return;
      }
    } catch {}
    const direct = $('#courseAction') || $('.today-add-task') || $('#globalAddBtn') || $('#mobileCreateBtn');
    direct?.click();
    focusTaskTitle();
  }

  function handleNextCapture() {
    const dialog = $('#tourDialog');
    finalActionArmed = Boolean(dialog?.open && isLastStep() && !hasAnyTasks());
  }

  function handleNextComplete() {
    if (!finalActionArmed) return;
    finalActionArmed = false;
    if (!$('#tourDialog')?.open) {
      openFirstTask();
      return;
    }
    queueMicrotask(() => {
      if (!$('#tourDialog')?.open) openFirstTask();
    });
  }

  function polishHelpLabels() {
    const settings = $('#settingsGuide');
    if (settings) {
      const title = settings.querySelector('b');
      const hint = settings.querySelector('em');
      if (title && title.textContent !== 'Быстрое знакомство') title.textContent = 'Быстрое знакомство';
      if (hint && hint.textContent !== 'За полминуты вспомнить, что где находится') hint.textContent = 'За полминуты вспомнить, что где находится';
    }
    const more = $('#openGuideFromMore');
    if (more && more.textContent !== 'Быстрое знакомство с SEVER') more.textContent = 'Быстрое знакомство с SEVER';
  }

  function polishEmptyToday() {
    const empty = $('#todayTasks .empty');
    if (!empty) return;
    const copy = empty.querySelector('p');
    if (copy && copy.textContent !== EMPTY_TODAY_COPY) copy.textContent = EMPTY_TODAY_COPY;
    const button = empty.querySelector('.today-add-task');
    if (button && button.textContent !== EMPTY_TODAY_ACTION) button.textContent = EMPTY_TODAY_ACTION;
  }

  function refreshOpenHistoricalDay(date) {
    dayRefreshFrame = 0;
    const dialog = $('#dayDialog');
    if (!dialog?.open || !date) return;
    const cell = $(`#calendar > .day[data-sever-date="${date}"]`);
    if (!cell) return;
    dialog.close();
    cell.click();
  }

  function scheduleHistoricalDayRefresh(date) {
    clearTimeout(dayRefreshTimer);
    if (dayRefreshFrame) cancelAnimationFrame(dayRefreshFrame);
    dayRefreshTimer = setTimeout(() => {
      dayRefreshTimer = 0;
      dayRefreshFrame = requestAnimationFrame(() => refreshOpenHistoricalDay(date));
    }, 0);
  }

  function installHistoricalDayRepair() {
    document.addEventListener('click', event => {
      const dialog = $('#dayDialog');
      if (!dialog?.open) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('#dayTaskList .check, #toast button')) return;
      const date = window.SeverApp?.getContext?.().selectedDate || '';
      scheduleHistoricalDayRefresh(date);
    }, true);
  }

  function installObservers() {
    const dialog = $('#tourDialog');
    if (dialog && !guideObserver) {
      guideObserver = new MutationObserver(syncGuideChrome);
      guideObserver.observe(dialog, { attributes: true, attributeFilter: ['open', 'data-step', 'data-has-target'] });
      $('#tourNext')?.addEventListener('click', handleNextCapture, true);
      $('#tourNext')?.addEventListener('click', handleNextComplete);
      syncGuideChrome();
    }
    const tasks = $('#todayTasks');
    if (tasks && !todayObserver) {
      todayObserver = new MutationObserver(polishEmptyToday);
      todayObserver.observe(tasks, { childList: true, subtree: true });
      polishEmptyToday();
    }
  }

  function installLocalFirstRunFallback() {
    // The core intentionally waits for cloud hydration before automatic onboarding
    // so a returning signed-in account never sees a false first-run tour. In local
    // mode there is nothing to hydrate; this bounded fallback only repairs a missed
    // ready-event/order race and never bypasses configured account startup.
    setTimeout(() => {
      if (state()?.onboarded || $('#tourDialog')?.open) return;
      const cloud = window.SeverCloud;
      if (!cloud || cloud.configured !== false || window.SeverCloudReady) return;
      window.dispatchEvent(new Event('sever:cloud-ready'));
    }, 1200);
  }

  function boot(attempt = 0) {
    if (installed) return;
    if (!window.SeverApp?.getState || !$('#tourDialog') || !$('#todayTasks')) {
      if (attempt < 160) setTimeout(() => boot(attempt + 1), 50);
      return;
    }
    installed = true;
    replaceCoreSlides();
    polishHelpLabels();
    installHistoricalDayRepair();
    installObservers();
    installLocalFirstRunFallback();
    syncGuideChrome();
    document.documentElement.dataset.severOnboarding = 'v110';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
  window.addEventListener('sever:ready', () => {
    if (!installed) boot();
    else {
      replaceCoreSlides();
      polishHelpLabels();
      polishEmptyToday();
      syncGuideChrome();
    }
  });
})();