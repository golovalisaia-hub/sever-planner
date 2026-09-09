(function () {
  'use strict';
  const ids = Object.freeze(['calm', 'cozy', 'focus']);
  const aliases = Object.freeze({
    light: 'calm', dawn: 'cozy', black: 'focus', dark: 'focus',
    minimal: 'calm', north: 'focus', polar: 'focus', motion: 'focus', aurora: 'focus'
  });
  const names = Object.freeze({ calm: 'Calm Balance', cozy: 'Cozy Mood', focus: 'Focus Peak' });
  const colors = Object.freeze({ calm: '#F7F4F0', cozy: '#FFF6EF', focus: '#08100E' });
  const canonical = value => ids.includes(value) ? value : Object.hasOwn(aliases, value) ? aliases[value] : 'calm';
  let saved, scope;
  try {
    saved = localStorage.getItem('sever-theme');
    scope = localStorage.getItem('sever-theme-scope');
    // A cached account theme is paint-only: it never grants access to account data.
    if (!scope || scope === 'sever-anonymous-state-v1') {
      const local = JSON.parse(localStorage.getItem('sever-anonymous-state-v1') || 'null');
      const legacy = !local && !localStorage.getItem('sever-legacy-migration-v1')
        ? JSON.parse(localStorage.getItem('sever-data-v2') || 'null') : null;
      saved = local?.appearance?.theme || legacy?.appearance?.theme || saved;
    }
  } catch { /* Storage may be unavailable; the default still paints correctly. */ }
  const initial = canonical(saved);
  window.SeverTheme = Object.freeze({ ids, aliases, names, colors, canonical, initial,
    pendingAccount: Boolean(scope && scope !== 'sever-anonymous-state-v1') });
  document.documentElement.dataset.theme = initial;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = colors[initial];
})();
