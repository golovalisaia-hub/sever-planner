(function () {
  'use strict';

  const expandedBodies = new Set();
  const expandedChecklists = new Set();
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
    if (name === 'more') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
    if (name === 'less') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
    if (name === 'check') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
    return '';
  }

  function ensureChecklistPreview(card, note, data) {
    const items = Array.isArray(data?.items) ? data.items : [];
    const expanded = expandedChecklists.has(note.id);
    card.dataset.notesCompactChecklist = String(items.length > 0);
    card.classList.toggle('notes-polish-checklist-expanded', expanded);

    let control = card.querySelector('.notes-core-more-items');
    if (items.length <= 3) {
      control?.remove();
      expandedChecklists.delete(note.id);
      card.classList.remove('notes-polish-checklist-expanded');
      return;
    }

    if (control && control.tagName !== 'BUTTON') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = control.className;
      control.replaceWith(button);
      control = button;
    }
    if (!control) {
      control = document.createElement('button');
      control.type = 'button';
      control.className = 'notes-core-more-items';
      card.querySelector('.note-checklist')?.after(control);
    }

    const remaining = Math.max(0, items.length - 3);
    control.dataset.noteId = note.id;
    control.dataset.notesCompactOpen = 'true';
    control.setAttribute('aria-expanded', String(expanded));
    control.setAttribute('aria-label', expanded ? 'Свернуть чек-лист' : `Показать ещё ${remaining} пунктов`);
    control.innerHTML = `<span>${expanded ? 'Свернуть' : `Ещё ${remaining}`}</span>${icon(expanded ? 'less' : 'more')}`;
    control.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      if (expandedChecklists.has(note.id)) expandedChecklists.delete(note.id);
      else expandedChecklists.add(note.id);
      decorateCard(card, note);
      if (!expandedChecklists.has(note.id)) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
  }

  function ensureBodyToggle(card, note, data) {
    const body = card.querySelector('.note-body');
    const text = String(data?.body || '');
    let toggle = card.querySelector('.notes-polish-body-toggle');
    const shouldOffer = data?.kind !== 'checklist' && (text.length > 150 || text.split(/\n/).length > 4);
    if (!shouldOffer) {
      toggle?.remove();
      expandedBodies.delete(note.id);
      card.classList.remove('notes-polish-body-expanded');
      return;
    }
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'notes-polish-body-toggle';
      body?.after(toggle);
    }
    const expanded = expandedBodies.has(note.id);
    card.classList.toggle('notes-polish-body-expanded', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Свернуть текст заметки' : 'Показать больше текста заметки');
    toggle.innerHTML = `<span>${expanded ? 'Свернуть' : 'Ещё'}</span>${icon(expanded ? 'less' : 'more')}`;
    toggle.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      if (expandedBodies.has(note.id)) expandedBodies.delete(note.id);
      else expandedBodies.add(note.id);
      decorateCard(card, note);
      if (!expandedBodies.has(note.id)) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    ensureChecklistPreview(card, note, data);
    ensureBodyToggle(card, note, data);
    polishBulkAction(card, data);
    card.querySelector('.note-card-footer')?.classList.add('notes-polish-footer');
    card.querySelector('.note-card-actions')?.classList.add('notes-polish-actions');
  }

  function decorateEditor() {
    const dialog = document.querySelector('#noteDialog');
    const form = document.querySelector('#noteForm');
    if (!dialog || !form) return;
    dialog.classList.add('notes-polish-editor');
    form.classList.add('notes-polish-editor-form');
    document.querySelector('#checklistEditor')?.classList.add('notes-polish-checklist-editor');
    document.querySelector('#noteItemsEditor')?.classList.add('notes-polish-items-editor');
    form.querySelector('.dialog-actions')?.classList.add('notes-polish-editor-actions');
  }

  function decorate() {
    scheduled = false;
    document.querySelectorAll('#noteList .note-card[data-note-id]').forEach(card => {
      const note = noteById(card.dataset.noteId);
      if (note) decorateCard(card, note);
    });
    decorateEditor();

    const actionDialog = document.querySelector('#notesActionDialog');
    if (actionDialog) {
      actionDialog.classList.add('notes-polish-action-dialog');
      const hint = actionDialog.querySelector('#notesActionHint');
      if (hint) hint.textContent = 'Что сделать с этой заметкой?';
      const edit = actionDialog.querySelector('[data-notes-action="edit"]');
      if (edit) edit.textContent = 'Изменить заметку';
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
    document.querySelector('#noteDialog')?.addEventListener('toggle', schedule);
    schedule();
    document.documentElement.dataset.severNotesPolish = 'ready';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
  window.addEventListener('sever:ready', () => { if (!booted) boot(); else schedule(); });
})();
