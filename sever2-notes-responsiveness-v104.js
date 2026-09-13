(function () {
  'use strict';

  let booted = false;
  let persistScheduled = false;

  function plannerState() {
    return window.SeverApp?.getState?.() || null;
  }

  function noteForCard(card) {
    if (!card?.dataset.noteId) return null;
    return plannerState()?.notes?.find(note => String(note.id) === String(card.dataset.noteId)) || null;
  }

  function checklistItems(note) {
    return Array.isArray(note?.items) ? note.items : [];
  }

  function progressFor(items) {
    if (!items.length) return 0;
    return Math.round(items.filter(item => item.done).length / items.length * 100);
  }

  function reportPersistFailure() {
    try {
      if (typeof toast === 'function') toast('Изменение сохранится после следующей попытки');
    } catch {}
  }

  // Paint the interaction first. save() snapshots to localStorage synchronously when
  // this frame finishes, while IndexedDB/cloud work is allowed to complete later.
  function persistAfterPaint() {
    if (persistScheduled) return;
    persistScheduled = true;
    requestAnimationFrame(() => {
      persistScheduled = false;
      try {
        if (typeof save !== 'function') return;
        Promise.resolve(save()).catch(reportPersistFailure);
      } catch {
        reportPersistFailure();
      }
    });
  }

  function syncBulkAction(card, items) {
    const button = card.querySelector('.note-toggle-all');
    if (!button || !items.length) return;
    const allDone = items.every(item => item.done);
    const renderKey = allDone ? 'all-done' : 'pending';
    button.setAttribute('aria-label', allDone ? 'Снять отметки со всех пунктов' : 'Отметить все пункты выполненными');
    button.dataset.notesPolishRender = renderKey;
    const label = button.querySelector('span');
    if (label) label.textContent = allDone ? 'Снять отметки' : 'Выполнить все';
    else button.textContent = allDone ? 'Снять отметки' : 'Выполнить все';
  }

  function syncCard(card, note) {
    const items = checklistItems(note);
    const progress = progressFor(items);
    const checks = [...card.querySelectorAll('.note-checklist .note-check')];

    checks.forEach((label, index) => {
      const item = items[index];
      const checkbox = label.querySelector('input[type="checkbox"]');
      if (!item || !checkbox) return;
      checkbox.checked = Boolean(item.done);
      label.classList.toggle('done', Boolean(item.done));
    });

    const ring = card.querySelector('.note-ring');
    if (ring) {
      ring.setAttribute('aria-label', `Выполнено ${progress}%`);
      const value = ring.querySelector('.value');
      if (value) value.style.strokeDashoffset = String(213.63 * (1 - progress / 100));
      const number = ring.querySelector('b');
      if (number) number.textContent = `${progress}%`;
    }

    card.classList.toggle('complete', items.length > 0 && items.every(item => item.done));
    syncBulkAction(card, items);

    const time = card.querySelector('time');
    if (time) time.textContent = `Обновлено ${new Date(note.updatedAt || Date.now()).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
  }

  function itemIndexForCheckbox(card, checkbox) {
    return [...card.querySelectorAll('.note-checklist input[type="checkbox"]')].indexOf(checkbox);
  }

  function onChecklistChange(event) {
    const checkbox = event.target.closest?.('.note-checklist input[type="checkbox"]');
    if (!checkbox) return;
    const card = checkbox.closest('.note-card[data-note-id]');
    const note = noteForCard(card);

    // Protected notes keep their existing encrypted save path. v104 only replaces
    // the ordinary-note hot path so security semantics cannot be weakened.
    if (!card || !note || note.protected) return;
    const items = checklistItems(note);
    const index = itemIndexForCheckbox(card, checkbox);
    if (index < 0 || !items[index]) return;

    event.stopImmediatePropagation();
    items[index].done = Boolean(checkbox.checked);
    note.done = items.length > 0 && items.every(item => item.done);
    note.updatedAt = Date.now();
    syncCard(card, note);
    persistAfterPaint();
  }

  function onBulkClick(event) {
    const button = event.target.closest?.('.note-toggle-all');
    if (!button) return;
    const card = button.closest('.note-card[data-note-id]');
    const note = noteForCard(card);
    if (!card || !note || note.protected) return;
    const items = checklistItems(note);
    if (!items.length) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const nextDone = !items.every(item => item.done);
    items.forEach(item => { item.done = nextDone; });
    note.done = nextDone;
    note.updatedAt = Date.now();
    syncCard(card, note);
    persistAfterPaint();
    try {
      if (typeof toast === 'function') toast(nextDone ? 'Все пункты выполнены' : 'Отметки сняты');
    } catch {}
  }

  function boot(attempt = 0) {
    if (booted) return;
    const root = document.querySelector('#notesView');
    if (!root || !window.SeverApp || !window.SeverNotes) {
      if (attempt < 180) setTimeout(() => boot(attempt + 1), 50);
      return;
    }

    booted = true;
    // Capture phase wins before the legacy per-checkbox onchange handler, which
    // awaited persistence and then rebuilt the complete notes list.
    root.addEventListener('change', onChecklistChange, true);
    root.addEventListener('click', onBulkClick, true);
    document.documentElement.dataset.severNotesResponsiveness = 'v104';
  }

  window.SeverNotesResponsiveness = Object.freeze({
    version: 'v104',
    syncCard
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
  window.addEventListener('sever:ready', () => boot());
})();
