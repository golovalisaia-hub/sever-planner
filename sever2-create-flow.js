(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const ROUTES = [
    { trigger: '#quickAddTask', parent: 'quickAddDialog', child: 'taskDialog' },
    { trigger: '#quickAddNote', parent: 'quickAddDialog', child: 'noteDialog' },
    { trigger: '#quickAddFolder', parent: 'quickAddDialog', child: 'folderDialog' },
    { trigger: '#quickAddHabit', parent: 'quickAddDialog', child: 'habitDialog' },
    { trigger: '#noteCreateNote', parent: 'noteCreateSheet', child: 'noteDialog' },
    { trigger: '#noteCreateFolder', parent: 'noteCreateSheet', child: 'folderDialog' }
  ];
  let bootAttempts = 0;
  let bootTimer = 0;

  function closeControl(dialog) {
    return dialog?.querySelector(`[data-close="${dialog.id}"]`) || null;
  }

  function setBackLabel(dialog) {
    const control = closeControl(dialog);
    if (!control) return;
    if (!control.dataset.severOriginalLabel) control.dataset.severOriginalLabel = control.getAttribute('aria-label') || 'Закрыть';
    control.setAttribute('aria-label', 'Назад к меню «Создать»');
    control.title = 'Назад';
  }

  function restoreCloseLabel(dialog) {
    const control = closeControl(dialog);
    if (!control) return;
    const original = control.dataset.severOriginalLabel;
    if (original) control.setAttribute('aria-label', original);
    delete control.dataset.severOriginalLabel;
    control.removeAttribute('title');
  }

  function clearReturn(dialog) {
    if (!dialog) return;
    delete dialog.dataset.severReturnDialog;
    restoreCloseLabel(dialog);
  }

  function focusParent(parent) {
    if (parent.id === 'quickAddDialog') {
      const input = $('#quickCaptureInput');
      if (input && !input.disabled) input.focus({ preventScroll: true });
      return;
    }
    parent.querySelector('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])')?.focus({ preventScroll: true });
  }

  function returnToParent(dialog) {
    const parentId = dialog?.dataset.severReturnDialog || '';
    const parent = parentId ? document.getElementById(parentId) : null;
    if (!dialog || !parent) return false;
    if (dialog.open) dialog.close();
    clearReturn(dialog);
    requestAnimationFrame(() => {
      if (parent.open || document.querySelector('dialog[open]')) return;
      parent.showModal();
      requestAnimationFrame(() => focusParent(parent));
    });
    return true;
  }

  function armRoute({ trigger, parent, child }) {
    const button = $(trigger);
    const dialog = document.getElementById(child);
    if (!button || !dialog) return;
    const key = `severRoute${parent}${child}`;
    if (button.dataset[key] === 'ready') return;
    button.dataset[key] = 'ready';
    button.addEventListener('click', () => {
      dialog.dataset.severReturnDialog = parent;
      setBackLabel(dialog);
      requestAnimationFrame(() => {
        if (!dialog.open) clearReturn(dialog);
      });
    }, { capture: true });
  }

  function installChild(dialogId) {
    const dialog = document.getElementById(dialogId);
    if (!dialog || dialog.dataset.severCreateBackReady === 'true') return;
    dialog.dataset.severCreateBackReady = 'true';

    dialog.addEventListener('click', event => {
      if (!dialog.dataset.severReturnDialog) return;
      const control = event.target.closest?.(`[data-close="${dialogId}"]`);
      if (!control || !dialog.contains(control)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      returnToParent(dialog);
    }, true);

    dialog.addEventListener('cancel', event => {
      if (!dialog.dataset.severReturnDialog) return;
      event.preventDefault();
      returnToParent(dialog);
    });

    dialog.addEventListener('close', () => {
      if (dialog.dataset.severReturnDialog) clearReturn(dialog);
    });
  }

  function boot() {
    if (!window.SeverApp || !$('#quickAddDialog')) return false;
    ROUTES.forEach(armRoute);
    new Set(ROUTES.map(route => route.child)).forEach(installChild);
    document.documentElement.dataset.severCreateFlow = 'ready';
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, { once: true });
  window.addEventListener('sever:ready', scheduleBoot);
})();
