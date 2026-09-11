(function () {
  'use strict';

  /* SEVER 2 presentation bootstrap. Legacy ids stay compatible with stored user data. */
  const allowed = new Set(['light', 'motion', 'black']);
  const aliases = {
    calm: 'light', 'calm-balance': 'light', cozy: 'motion', 'cozy-mood': 'motion',
    focus: 'black', 'focus-peak': 'black', dark: 'black', minimal: 'black',
    polar: 'light', dawn: 'light', north: 'light', aurora: 'light'
  };
  const themes = {
    light: { name: 'Calm Balance', description: 'Светлая, спокойная и воздушная', color: '#F1E9E3', preview: 'theme-calm', ui: 'calm' },
    motion: { name: 'Cozy Mood', description: 'Тёплая, мягкая и уютная', color: '#F3ECE7', preview: 'theme-cozy', ui: 'cozy' },
    black: { name: 'Focus Peak', description: 'Тёмная, тихая и концентрированная', color: '#111618', preview: 'theme-focus', ui: 'focus' }
  };

  const stylesheets = [
    ['sever-desktop-system', 'desktop-system.css?v=60'],
    ['sever-theme-pack', 'themes.css?v=60'],
    ['sever2-ui-pack', 'sever2-ui.css?v=61'],
    ['sever2-qa-pack', 'sever2-qa.css?v=61'],
    ['sever2-productivity-pack', 'sever2-productivity.css?v=64'],
    ['sever2-focus-flow-pack', 'sever2-focus-flow.css?v=66'],
    ['sever2-efficiency-pack', 'sever2-efficiency.css?v=67'],
    ['sever2-calendar-clarity-pack', 'sever2-calendar-clarity.css?v=68'],
    ['sever2-home-core-pack', 'sever2-home-core.css?v=70'],
    ['sever2-notes-core-pack', 'sever2-notes-core.css?v=71'],
    ['sever2-notes-organization-pack', 'sever2-notes-organization.css?v=72'],
    ['sever2-notes-editor-flow-pack', 'sever2-notes-editor-flow.css?v=73'],
    ['sever2-notes-navigation-pack', 'sever2-notes-navigation.css?v=74'],
    ['sever2-notes-polish-pack', 'sever2-notes-polish.css?v=75'],
    ['sever2-mobile-consistency-pack', 'sever2-mobile-consistency.css?v=76']
  ];
  const scripts = [
    ['sever2-productivity-script', 'sever2-productivity.js?v=64'],
    ['sever2-focus-flow-script', 'sever2-focus-flow.js?v=66'],
    ['sever2-efficiency-script', 'sever2-efficiency.js?v=67'],
    ['sever2-calendar-clarity-script', 'sever2-calendar-clarity.js?v=68'],
    ['sever2-create-flow-script', 'sever2-create-flow.js?v=69'],
    ['sever2-home-core-script', 'sever2-home-core.js?v=70'],
    ['sever2-notes-core-script', 'sever2-notes-core.js?v=71'],
    ['sever2-notes-organization-script', 'sever2-notes-organization.js?v=72'],
    ['sever2-notes-editor-flow-script', 'sever2-notes-editor-flow.js?v=73'],
    ['sever2-notes-navigation-script', 'sever2-notes-navigation.js?v=74'],
    ['sever2-notes-polish-script', 'sever2-notes-polish.js?v=75']
  ];

  function normalize(value) {
    const candidate = aliases[value] || value;
    return allowed.has(candidate) ? candidate : 'light';
  }

  function readPersistedTheme() {
    try { return localStorage.getItem('sever-theme') || ''; }
    catch { return ''; }
  }

  function retireLegacyHomeLayer() {
    const oldMobileHome = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .find(link => /(?:^|\/)mobile-home\.css(?:\?|$)/.test(link.getAttribute('href') || ''));
    if (oldMobileHome) {
      oldMobileHome.disabled = true;
      oldMobileHome.dataset.retiredBySever2 = 'true';
    }
  }

  function installStylesheets() {
    stylesheets.forEach(([marker, href]) => {
      if (document.querySelector(`link[data-${marker}]`)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute(`data-${marker}`, 'v76');
      document.head.appendChild(link);
    });
  }

  function installScripts() {
    scripts.forEach(([marker, src]) => {
      if (document.querySelector(`script[data-${marker}]`)) return;
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.defer = true;
      script.setAttribute(`data-${marker}`, 'v76');
      document.head.appendChild(script);
    });
  }

  function applyEarlyTheme() {
    const selected = normalize(readPersistedTheme());
    document.documentElement.dataset.theme = selected;
    document.documentElement.dataset.severMood = themes[selected].ui;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = themes[selected].color;
  }

  function rewriteToast(theme) {
    requestAnimationFrame(() => {
      const label = document.querySelector('#toast span');
      if (label && /^Тема:/.test(label.textContent || '')) label.textContent = `Тема: ${themes[theme].name}`;
    });
  }

  function syncPresentation(theme) {
    const selected = normalize(theme);
    const info = themes[selected];
    if (document.documentElement.dataset.theme !== selected) document.documentElement.dataset.theme = selected;
    document.documentElement.dataset.severMood = info.ui;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = info.color;
    const menuTheme = document.querySelector('#menuTheme small');
    if (menuTheme) menuTheme.textContent = info.name;
    document.querySelectorAll('[data-sever-theme]').forEach(button => {
      const active = button.dataset.severTheme === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    rewriteToast(selected);
  }

  function makePreview(preview, info) {
    if (!preview) return;
    preview.className = `theme-preview ${info.preview}`;
    preview.innerHTML = '<i></i><i></i><i></i><span class="theme-preview-accent" aria-hidden="true"></span>';
  }

  function preparePicker() {
    const picker = document.querySelector('.theme-picker');
    if (!picker) { syncPresentation(document.documentElement.dataset.theme); return; }
    const allButtons = [...picker.querySelectorAll('[data-sever-theme]')];
    const buttons = new Map(allButtons.map(button => [button.dataset.severTheme, button]));
    buttons.get('north')?.remove();
    buttons.get('aurora')?.remove();
    ['light', 'motion', 'black'].forEach(id => {
      const button = buttons.get(id);
      if (!button) return;
      const info = themes[id];
      const title = button.querySelector('b');
      const description = button.querySelector('em');
      if (title) title.textContent = info.name;
      if (description) description.textContent = info.description;
      makePreview(button.querySelector('.theme-preview'), info);
      button.setAttribute('aria-label', `${info.name}: ${info.description}`);
      button.dataset.themeDisplayName = info.name;
      button.dataset.themeMood = info.ui;
      if (button.dataset.severThemeWrapped !== 'true') {
        const original = button.onclick;
        button.onclick = function (event) { original?.call(this, event); syncPresentation(id); };
        button.dataset.severThemeWrapped = 'true';
      }
      picker.appendChild(button);
    });
    picker.dataset.severThemePackReady = 'true';
    const currentRaw = document.documentElement.dataset.theme || '';
    const persistedRaw = readPersistedTheme();
    const selected = normalize(persistedRaw || currentRaw);
    if (!allowed.has(currentRaw) || (persistedRaw && !allowed.has(persistedRaw))) {
      try { localStorage.setItem('sever-theme', selected); } catch {}
      document.documentElement.dataset.theme = selected;
    }
    syncPresentation(selected);
  }

  function storedPlannerTheme() {
    try {
      const scope = window.SeverApp?.getStorageScope?.();
      if (!scope) return '';
      return JSON.parse(localStorage.getItem(scope) || '{}')?.appearance?.theme || '';
    } catch { return ''; }
  }

  function settleFirstThemeForFreshProfile(attempt = 0) {
    const app = window.SeverApp;
    const state = app?.getState?.();
    if (!state || state.onboarded !== false) return;

    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.severMood = themes.light.ui;
    try { localStorage.setItem('sever-theme', 'light'); } catch {}
    syncPresentation('light');

    /* initializeApp is async. Wait for its first persistent save before using
       the app's own theme handler, otherwise recovery can restore legacy Aurora. */
    if (!Number(state._savedAt)) {
      if (attempt < 80) setTimeout(() => settleFirstThemeForFreshProfile(attempt + 1), 25);
      return;
    }

    if (state.appearance?.theme === 'light' && normalize(storedPlannerTheme()) === 'light') return;
    const lightButton = document.querySelector('.theme-picker [data-sever-theme="light"]');
    if (lightButton?.dataset.severThemeWrapped === 'true') {
      lightButton.click();
      if (attempt < 80) setTimeout(() => settleFirstThemeForFreshProfile(attempt + 1), 25);
      return;
    }

    if (attempt < 80) setTimeout(() => settleFirstThemeForFreshProfile(attempt + 1), 25);
  }

  function polishCopy() {
    const themeSection = document.querySelector('.settings-appearance > small');
    if (themeSection) themeSection.textContent = 'ОФОРМЛЕНИЕ';
    const themeGroup = document.querySelector('.theme-picker');
    if (themeGroup) themeGroup.setAttribute('aria-label', 'Выберите настроение интерфейса');
    const settingsVersion = document.querySelector('.settings-version');
    if (settingsVersion && !settingsVersion.dataset.sever2Copy) {
      settingsVersion.textContent = 'SEVER 2.0 · один планер, три оформления · данные и синхронизация сохранены.';
      settingsVersion.dataset.sever2Copy = 'true';
    }
    const todayMotto = document.querySelector('#todayMotto');
    if (todayMotto && /вершин/i.test(todayMotto.textContent || '')) todayMotto.textContent = 'Главное на сегодня — перед глазами.';
  }

  function installLegacyThemeGuard() {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const raw = root.dataset.theme || '';
      const normalized = normalize(raw);
      if (raw !== normalized) root.dataset.theme = normalized;
      root.dataset.severMood = themes[normalized].ui;
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }

  retireLegacyHomeLayer();
  installStylesheets();
  installScripts();
  applyEarlyTheme();
  installLegacyThemeGuard();

  window.addEventListener('DOMContentLoaded', () => {
    preparePicker();
    polishCopy();
    document.body?.classList.add('sever2-ready');
  }, { once: true });

  window.addEventListener('sever:ready', () => {
    preparePicker();
    polishCopy();
    syncPresentation(document.documentElement.dataset.theme);
    settleFirstThemeForFreshProfile();
  });
})();
