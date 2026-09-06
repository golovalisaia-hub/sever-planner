(function () {
  'use strict';
  const allowed = new Set(['black', 'light', 'north', 'motion', 'aurora']);
  const aliases = { dark: 'black', minimal: 'black', polar: 'north', dawn: 'light' };
  try {
    const saved = localStorage.getItem('sever-theme');
    const normalized = aliases[saved] || saved;
    document.documentElement.dataset.theme = allowed.has(normalized) ? normalized : 'aurora';
  } catch { document.documentElement.dataset.theme = 'aurora'; }
})();
