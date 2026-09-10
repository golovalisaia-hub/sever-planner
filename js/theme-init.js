(function () {
  'use strict';

  /*
   * SEVER 2 theme bridge.
   * The planner still persists the stabilized legacy ids internally so we do
   * not touch task/sync/business logic. The visible product exposes exactly
   * three moods: Calm Balance, Cozy Mood and Focus Peak.
   *
   * Internal compatibility mapping:
   *   light  -> Calm Balance
   *   motion -> Cozy Mood
   *   black  -> Focus Peak
   */
  const THEME_STYLESHEET = 'themes.css?v=57';
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
      description: 'Светлая и спокойная',
      color: '#F7F2EC',
      preview: 'theme-calm'
    },
    motion: {
      name: 'Cozy Mood',
      description: 'Тёплая и мягкая',
      color: '#FFF4EC',
      preview: 'theme-cozy'
    },
    black: {
      name: 'Focus Peak',
      description: 'Тёмная и концентрированная',
      color: '#07100E',
      preview: 'theme-focus'
    }
  };

  function normalize(value) {
    const candidate = aliases[value] || value;
    return allowed.has(candidate) ? candidate : 'light';
  }

  function installStylesheet() {
    if (document.querySelector('link[data-sever-theme-pack]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = THEME_STYLESHEET;
    link.dataset.severThemePack = 'v1';
    document.head.appendChild(link);
  }

  function applyEarlyTheme() {
    let saved = '';
    try { saved = localStorage.getItem('sever-theme') || ''; } catch {}
    const selected = normalize(saved);
    document.documentElement.dataset.theme = selected;
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
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = info.color;
    const menuTheme = document.querySelector('#menuTheme small');
    if (menuTheme) menuTheme.textContent = info.name;
    document.querySelectorAll('[data-sever-theme]').forEach(button => {
      const active = button.dataset.severTheme === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
    rewriteToast(selected);
  }

  function preparePicker() {
    const picker = document.querySelector('.theme-picker');
    if (!picker || picker.dataset.severThemePackReady === 'true') {
      syncPresentation(document.documentElement.dataset.theme);
      return;
    }

    const buttons = new Map(
      [...picker.querySelectorAll('[data-sever-theme]')]
        .map(button => [button.dataset.severTheme, button])
    );

    /* Old themes are retired from the product. Keep no selectable legacy UI. */
    buttons.get('north')?.remove();
    buttons.get('aurora')?.remove();

    ['light', 'motion', 'black'].forEach(id => {
      const button = buttons.get(id);
      if (!button) return;
      const info = themes[id];
      const title = button.querySelector('b');
      const description = button.querySelector('em');
      const preview = button.querySelector('.theme-preview');
      if (title) title.textContent = info.name;
      if (description) description.textContent = info.description;
      if (preview) preview.className = `theme-preview ${info.preview}`;
      button.setAttribute('aria-label', `${info.name}: ${info.description}`);
      button.dataset.themeDisplayName = info.name;

      /* app.js already owns persistence. Preserve that handler and only add
       * presentation synchronization around it. */
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

    /* Existing users with Aurora/North are migrated once through the real
     * app handler, so appearance persistence and cloud settings stay valid. */
    const currentRaw = document.documentElement.dataset.theme || '';
    const selected = normalize(currentRaw);
    if (!allowed.has(currentRaw)) {
      const target = buttons.get(selected) || buttons.get('light');
      if (target?.onclick) target.click();
      else document.documentElement.dataset.theme = selected;
    }
    syncPresentation(document.documentElement.dataset.theme);
  }

  installStylesheet();
  applyEarlyTheme();
  window.addEventListener('DOMContentLoaded', preparePicker, { once: true });
  window.addEventListener('sever:ready', preparePicker, { once: true });
})();
