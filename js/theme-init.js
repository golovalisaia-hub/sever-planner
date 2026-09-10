(function () {
  'use strict';

  /*
   * SEVER 2 — unified presentation bootstrap.
   *
   * The product remains the same planner and keeps the existing persisted
   * data/auth/sync model.  The legacy internal theme ids are deliberately
   * retained as a compatibility boundary so old accounts do not lose their
   * saved appearance setting:
   *   light  -> Calm Balance
   *   motion -> Cozy Mood
   *   black  -> Focus Peak
   *
   * Aurora/North are retired from the visible product and migrate to Calm.
   */
  const allowed = new Set(['light', 'motion', 'black']);
  const aliases = {
    calm: 'light',
    'calm-balance': 'light',
    cozy: 'motion',
    'cozy-mood': 'motion',
    focus: 'black',
    'focus-peak': 'black',
    dark: 'black',
    minimal: 'black',
    polar: 'light',
    dawn: 'light',
    north: 'light',
    aurora: 'light'
  };
  const themes = {
    light: {
      name: 'Calm Balance',
      description: 'Светлая, спокойная и воздушная',
      color: '#F3ECE6',
      preview: 'theme-calm',
      ui: 'calm'
    },
    motion: {
      name: 'Cozy Mood',
      description: 'Тёплая, мягкая и уютная',
      color: '#F5ECE7',
      preview: 'theme-cozy',
      ui: 'cozy'
    },
    black: {
      name: 'Focus Peak',
      description: 'Тёмная, тихая и концентрированная',
      color: '#111718',
      preview: 'theme-focus',
      ui: 'focus'
    }
  };

  const stylesheets = [
    ['sever-desktop-system', 'desktop-system.css?v=60'],
    ['sever-desktop-home', 'desktop-home.css?v=60'],
    ['sever-theme-pack', 'themes.css?v=60'],
    ['sever2-ui-pack', 'sever2-ui.css?v=60']
  ];

  function normalize(value) {
    const candidate = aliases[value] || value;
    return allowed.has(candidate) ? candidate : 'light';
  }

  function installStylesheets() {
    stylesheets.forEach(([marker, href]) => {
      if (document.querySelector(`link[data-${marker}]`)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute(`data-${marker}`, 'v60');
      document.head.appendChild(link);
    });
  }

  function applyEarlyTheme() {
    let saved = '';
    try { saved = localStorage.getItem('sever-theme') || ''; } catch {}
    const selected = normalize(saved);
    document.documentElement.dataset.theme = selected;
    document.documentElement.dataset.severMood = themes[selected].ui;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = themes[selected].color;
  }

  function rewriteToast(theme) {
    requestAnimationFrame(() => {
      const label = document.querySelector('#toast span');
      if (label && /^Тема:/.test(label.textContent || '')) {
        label.textContent = `Тема: ${themes[theme].name}`;
      }
    });
  }

  function syncPresentation(theme) {
    const selected = normalize(theme);
    const info = themes[selected];

    if (document.documentElement.dataset.theme !== selected) {
      document.documentElement.dataset.theme = selected;
    }
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
    if (!picker) {
      syncPresentation(document.documentElement.dataset.theme);
      return;
    }

    const allButtons = [...picker.querySelectorAll('[data-sever-theme]')];
    const buttons = new Map(allButtons.map(button => [button.dataset.severTheme, button]));

    /* Legacy themes are removed from the rendered product, not merely hidden. */
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

      /* app.js remains the owner of persistence. We preserve its handler and
       * synchronize the presentation immediately after the stored change. */
      if (button.dataset.severThemeWrapped !== 'true') {
        const original = button.onclick;
        button.onclick = function (event) {
          original?.call(this, event);
          syncPresentation(id);
        };
        button.dataset.severThemeWrapped = 'true';
      }
      picker.appendChild(button);
    });

    picker.dataset.severThemePackReady = 'true';

    /* Migrate an old Aurora/North selection through the real app handler so
     * local and signed-in user settings stay coherent. */
    const currentRaw = document.documentElement.dataset.theme || '';
    const selected = normalize(currentRaw);
    if (!allowed.has(currentRaw)) {
      const target = buttons.get(selected) || buttons.get('light');
      if (target?.onclick) target.click();
      else document.documentElement.dataset.theme = selected;
    }
    syncPresentation(document.documentElement.dataset.theme);
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
    if (todayMotto && /вершин/i.test(todayMotto.textContent || '')) {
      todayMotto.textContent = 'Главное на сегодня — перед глазами.';
    }
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

  installStylesheets();
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
  });
})();
