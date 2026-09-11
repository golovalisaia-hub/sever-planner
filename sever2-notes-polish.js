(function () {
  'use strict';

  const expandedChecklists = new Set();
  const expandedBodies = new Set();
  let observer = null;
  let scheduled = false;
  let booted = false;

  function state() {
    return window.SeverApp?.getState?.() || null;
  }

  function noteById(id) {
    return state()?.notes?.find(note => note.id === id) || null;
  }

  function visible(note) {
    if (!note) return null;
    try {
      if (typeof visibleNoteData === 'function') return visibleNoteData(note);
    } catch {}
    return note.protected ? null : note;
  }

  function icon(name) {
    if (name === 'more') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    if (name === 'less') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
    if (name === 'check') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
    return '';
  }

  function markExpanded(card, noteId) {
    const checklistExpanded = expandedChecklists.has(noteId);
    const bodyExpanded = expandedBodies.has(noteId);
    card.classList.toggle('notes-polish-checklist-expanded', checklistExpanded);
    card.classList.toggle('notes-polish-body-expanded', bodyExpanded);
  }

  function ensureChecklistToggle(card, note, data) {
    const items = Array.isArray(data?.items) ? data.items : [];
    let old = card.querySelector('.notes-core-more-items');
    if (items.length <= 2) {
      old?.remove();
      expandedChecklists.delete(note.id);
      return;
    }

    if (old && old.tagName !== 'BUTTON') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = old.className;
      old.replaceWith(button);
      old = button;
    }
    if (!old) {
      old = document.createElement('button');
      old.type = 'button';
      old.className = 'notes-core-more-items';
      card.querySelector('.note-checklist')?.after(old);
    }

    const expanded = expandedChecklists.has(note.id);
    old.dataset.noteId = note.id;
    old.setAttribute('aria-expanded', String(expanded));
    old.setAttribute('aria-label', expanded ? 'Свернуть чек-лист' : `Показать ещё ${items.length - 2} пунктов`);
    old.innerHTML = `${expanded ? icon('less') : icon('more')}<span>${expanded ? 'Свернуть' : `Ещё ${items.length - 2}`}</span>`;
    old.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      if (expandedChecklists.has(note.id)) expandedChecklists.delete(note.id);
      else expandedChecklists.add(note.id);
      decorateCard(card, note);
    };
  }

  function ensureBodyToggle(card, note, data) {
    const body = card.querySelector('.note-body');
    const text = String(data?.body || '');
    let toggle = card.querySelector('.notes-polish-body-toggle');
    const shouldOffer = data?.kind !== 'checklist' && text.length > 150;
    if (!shouldOffer) {
      toggle?.remove();
      expandedBodies.delete(note.id);
      return;
    }
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'notes-polish-body-toggle';
      body?.after(toggle);
    }
    const expanded = expandedBodies.has(note.id);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.innerHTML = `${expanded ? icon('less') : icon('more')}<span>${expanded ? 'Свернуть' : 'Показать полностью'}</span>`;
    toggle.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      if (expandedBodies.has(note.id)) expandedBodies.delete(note.id);
      else expandedBodies.add(note.id);
      decorateCard(card, note);
    };
  }

  function polishBulkAction(card, data) {
    const button = card.querySelector('.note-toggle-all');
    if (!button) return;
    const items = Array.isArray(data?.items) ? data.items : [];
    const allDone = items.length > 0 && items.every(item => item.done);
    button.classList.add('notes-polish-bulk-action');
    button.setAttribute('aria-label', allDone ? 'Снять отметки со всех пунктов' : 'Отметить все пункты выполненными');
    button.innerHTML = `${icon('check')}<span>${allDone ? 'Снять отметки' : 'Выполнить все'}</span>`;
  }

  function decorateCard(card, note) {
    if (!card || !note?.id) return;
    const data = visible(note);
    if (!data) return;
    card.classList.add('notes-polish-card');
    markExpanded(card, note.id);
    ensureChecklistToggle(card, note, data);
    ensureBodyToggle(card, note, data);
    polishBulkAction(card, data);

    const footer = card.querySelector('.note-card-footer');
    const actions = card.querySelector('.note-card-actions');
    if (footer) footer.classList.add('notes-polish-footer');
    if (actions) actions.classList.add('notes-polish-actions');
  }

  function decorate() {
    scheduled = false;
    document.querySelectorAll('#noteList .note-card[data-note-id]').forEach(card => {
      const note = noteById(card.dataset.noteId);
      if (note) decorateCard(card, note);
    });

    const actionDialog = document.querySelector('#notesActionDialog');
    if (actionDialog) {
      actionDialog.classList.add('notes-polish-action-dialog');
      const hint = actionDialog.querySelector('#notesActionHint');
      if (hint && !hint.dataset.notesPolishCopy) {
        hint.dataset.notesPolishCopy = 'true';
        hint.textContent = 'Что сделать с этой заметкой?';
      }
      actionDialog.querySelector('[data-notes-action="edit"]')?.replaceChildren(document.createTextNode('Открыть заметку'));
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(decorate);
  }

  function boot(attempt = 0) {
    if (booted) return;
    if (!window.SeverApp || !window.SeverNotes || !document.querySelector('#notesView')) {
      if (attempt < 180) setTimeout(() => boot(attempt + 1), 50);
      return;
    }
    booted = true;
    const root = document.querySelector('#notesView');
    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    schedule();
    document.documentElement.dataset.severNotesPolish = 'ready';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
  window.addEventListener('sever:ready', () => { if (!booted) boot(); else schedule(); });
})();
