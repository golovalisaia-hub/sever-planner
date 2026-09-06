(function () {
  'use strict';
  const allowed = new Set(['aurora', 'polar', 'dawn', 'minimal']);
  try {
    const saved = localStorage.getItem('sever-theme');
    document.documentElement.dataset.theme = allowed.has(saved) ? saved : saved === 'light' ? 'dawn' : 'aurora';
  } catch { document.documentElement.dataset.theme = 'aurora'; }
})();
