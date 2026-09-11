(function () {
  'use strict';

  let observer = null;
  let scheduled = false;
  let booted = false;

  function icon(name) {
    if (name === 'more') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    if (name === 'less') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
    return '';
  }

  function itemCount(card) {
    return card.querySelectorAll('.note-checklist .note-check').length;
  }

  function setExpanded(card, expanded, focusButton = false) {
    const button = card.querySelector('.notes-polish-expand');
    const count = itemCount(card);
    card.classList.toggle('notes-polish-expanded', expanded);
    if (!button) return;
    const hidden = Math.max(0, count - 2);
    button.setAttribute('aria-expanded', String(expanded));
    button.innerHTML = expanded
      ? `${icon('less')}<span>Свернуть</span>`
      : `${icon('more')}<span>Показать ещё ${hidden}</span>`;
    button.setAttribute('aria-label', expanded ? 'Свернуть чек-лист' : `Показать ещё ${hidden} пунктов`);
    if (focusButton) button.focus({ preventScroll: true });
  }

  function upgradeMoreButton(card) {
    const legacy = card.querySelector('.notes-core-more-items');
    const count = itemCount(card);
    if (!legacy || count <= 2) return;

    let button = card.querySelector('.notes-polish-expand');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'notes-core-more-items notes-polish-expand';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(card, !card.classList.contains('notes-polish-expanded'), true);
      });
      legacy.replaceWith(button);
    }
    setExpanded(card, card.classList.contains('notes-polish-expanded'));
  }

  function moveBulkAction(card) {
    const toggle = card.querySelector('.note-toggle-all');
    const checklist = card.querySelector('.note-checklist');
    if (!toggle || !checklist) return;

    let tools = card.querySelector('.notes-polish-checklist-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'notes-polish-checklist-tools';
      const more = card.querySelector('.notes-polish-expand, .notes-core-more-items');
      (more || checklist).after(tools);
    }
    if (toggle.parentElement !== tools) tools.appendChild(toggle);
    toggle.setAttribute(
      'aria-label',
      toggle.textContent.trim() === 'Снять все'
        ? 'Снять отметки со всех пунктов'
        : 'Отметить все пункты выполненными'
    );
  }

  function upgradeCard(card) {
    if (!(card instanceof HTMLElement)) return;
    card.classList.add('notes-polish-card');
    upgradeMoreButton(card);
    moveBulkAction(card);

    const edit = card.querySelector('.note-edit');
    if (edit) edit.setAttribute('aria-label', 'Изменить заметку');
    const actions = card.querySelector('.notes-org-action');
    if (actions) actions.setAttribute('aria-label', 'Ещё действия');
  }

  function compactActionSheet() {
    const dialog = document.querySelector('#notesActionDialog');
    if (!dialog || dialog.dataset.notesPolishReady === 'true') return;
    dialog.dataset.notesPolishReady = 'true';
    const hint = dialog.querySelector('#notesActionHint');
    if (hint) hint.textContent = 'Действия';
    const edit = dialog.querySelector('[data-notes-action="edit"]');
    if (edit) edit.textContent = 'Открыть';
  }

  function apply() {
    scheduled = false;
    document.querySelectorAll('#noteList .note-card').forEach(upgradeCard);
    compactActionSheet();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
  }

  function observe() {
    const root = document.querySelector('#notesView');
    if (!root || observer) return;
    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
  }

  function boot(attempt = 0) {
    if (booted) return;
    if (!window.SeverApp || !window.SeverNotes || !document.querySelector('#notesView')) {
      if (attempt < 180) setTimeout(() => boot(attempt + 1), 50);
      return;
    }
    booted = true;
    observe();
    schedule();
    document.documentElement.dataset.severNotesPolish = 'ready';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
  window.addEventListener('sever:ready', () => { if (!booted) boot(); else schedule(); });
})();
