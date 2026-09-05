(function () {
  'use strict';
  try { document.documentElement.dataset.theme = localStorage.getItem('sever-theme') || 'dark'; }
  catch { document.documentElement.dataset.theme = 'dark'; }
})();
