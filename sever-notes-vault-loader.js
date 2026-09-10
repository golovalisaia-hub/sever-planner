(() => {
  'use strict';

  let attempts = 0;
  let loading = false;

  function ready() {
    return Boolean(window.SeverProtectedNotesCrypto && window.SeverSecurityCore && window.SeverApp && window.SeverNotes);
  }

  function loadVault() {
    if (document.querySelector('script[data-sever-notes-vault-runtime]')) return;
    const script = document.createElement('script');
    script.src = 'sever-notes-vault.js?v=73';
    script.defer = true;
    script.dataset.severNotesVaultRuntime = 'v73';
    script.addEventListener('error', () => {
      loading = false;
      script.remove();
      if (attempts++ < 200) setTimeout(boot, 75);
    }, { once: true });
    document.head.appendChild(script);
  }

  function boot() {
    if (document.documentElement.dataset.severNotesVault) return;
    if (!ready()) {
      if (attempts++ < 240) setTimeout(boot, 50);
      return;
    }
    if (loading) return;
    loading = true;
    loadVault();
  }

  window.addEventListener('sever:ready', boot);
  window.addEventListener('DOMContentLoaded', boot, { once: true });
  boot();
})();
