(function () {
  'use strict';

  const DRAFT_KEY = 'sever-note-draft-v1';
  const MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const SAVE_DELAY_MS = 320;
  let dialog = null;
  let form = null;
  let status = null;
  let recovery = null;
  let observer = null;
  let saveTimer = 0;
  let restoring = false;
  let booted = false;
  let openedNoteId = '';

  function plannerState() {
    return window.SeverApp?.getState?.() || null;
  }

  function noteById(id) {
    if (!id) return null;
    return plannerState()?.notes?.find(note => note.id === id) || null;
  }

  function currentNoteId() {
    return document.querySelector('#noteId')?.value || '';
  }

  function currentBaseNote() {
    return noteById(currentNoteId());
  }

  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
  }

  function readDraft() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      if (!draft || draft.version !== 1 || draft.baseProtected || Date.now() - Number(draft.savedAt || 0) > MAX_AGE_MS) {
        clearDraft();
        return null;
      }
      return draft;
    } catch {
      clearDraft();
      return null;
    }
  }

  function writeDraft(draft) {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }
    catch { setStatus('Не удалось сохранить черновик', 'warning'); }
  }

  function isSensitiveDraft() {
    const protectedToggle = document.querySelector('#noteProtected');
    return Boolean(currentBaseNote()?.protected || protectedToggle?.checked);
  }

  function readItems() {
    return [...document.querySelectorAll('#noteItemsEditor .note-item-editor')]
      .map(row => ({
        text: row.querySelector('input[type="text"]')?.value || '',
        done: Boolean(row.querySelector('input[type="checkbox"]')?.checked)
      }))
      .filter(item => item.text.trim());
  }

  function currentKind() {
    return document.querySelector('#noteDialog [data-note-type].active')?.dataset.noteType === 'checklist' ? 'checklist' : 'text';
  }

  function snapshot(wasOpen = Boolean(dialog?.open)) {
    const existing = readDraft();
    const id = currentNoteId();
    const base = currentBaseNote();
    const sameDraft = existing && existing.noteId === id;
    return {
      version: 1,
      noteId: id,
      title: document.querySelector('#noteTitle')?.value || '',
      body: document.querySelector('#noteBody')?.value || '',
      folderId: document.querySelector('#noteFolder')?.value || '',
      kind: currentKind(),
      items: readItems(),
      baseUpdatedAt: Number(base?.updatedAt || 0),
      baseProtected: Boolean(base?.protected),
      startedAt: sameDraft ? Number(existing.startedAt || Date.now()) : Date.now(),
      savedAt: Date.now(),
      wasOpen
    };
  }

  function hasMeaningfulContent(draft) {
    return Boolean(
      draft.noteId || draft.title.trim() || draft.body.trim() || draft.folderId ||
      draft.kind === 'checklist' || draft.items.length
    );
  }

  function setStatus(text, state = 'idle') {
    if (!status) return;
    status.textContent = text;
    status.dataset.state = state;
  }

  function persistDraft(wasOpen = Boolean(dialog?.open)) {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!dialog?.open && wasOpen) return;
    if (isSensitiveDraft()) {
      clearDraft();
      setStatus('Защищённый режим · черновик не хранится', 'protected');
      return;
    }
    const draft = snapshot(wasOpen);
    if (!hasMeaningfulContent(draft)) {
      clearDraft();
      setStatus('Черновик сохраняется на этом устройстве', 'idle');
      return;
    }
    writeDraft(draft);
    setStatus('Черновик сохранён на устройстве', 'saved');
  }

  function scheduleDraft() {
    if (restoring || !dialog?.open) return;
    if (isSensitiveDraft()) {
      clearDraft();
      setStatus('Защищённый режим · черновик не хранится', 'protected');
      return;
    }
    setStatus('Сохраняем черновик…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistDraft(true), SAVE_DELAY_MS);
  }

  function comparableItems(items) {
    return (items || []).map(item => ({ text: String(item.text || '').trim(), done: Boolean(item.done) })).filter(item => item.text);
  }

  function sameDraftAsNote(draft, note) {
    if (!draft || !note || note.protected) return false;
    const left = JSON.stringify({
      title: String(draft.title || '').trim(),
      body: String(draft.body || '').trim(),
      folderId: draft.folderId || '',
      kind: draft.kind === 'checklist' ? 'checklist' : 'text',
      items: comparableItems(draft.items)
    });
    const right = JSON.stringify({
      title: String(note.title || '').trim(),
      body: String(note.body || '').trim(),
      folderId: note.folderId || '',
      kind: note.kind === 'checklist' ? 'checklist' : 'text',
      items: comparableItems(note.items)
    });
    return left === right;
  }

  function matchesRecentlySavedNewNote(draft) {
    if (!draft || draft.noteId) return false;
    return Boolean(plannerState()?.notes?.some(note =>
      !note.protected &&
      Number(note.createdAt || 0) >= Number(draft.startedAt || 0) - 1500 &&
      sameDraftAsNote(draft, note)
    ));
  }

  function setInputValue(selector, value) {
    const input = document.querySelector(selector);
    if (!input) return;
    input.value = value || '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function restoreChecklistItems(items) {
    const desired = comparableItems(items);
    const add = document.querySelector('#addNoteItem');
    let rows = [...document.querySelectorAll('#noteItemsEditor .note-item-editor')];
    while (rows.length < Math.max(1, desired.length) && add) {
      add.click();
      rows = [...document.querySelectorAll('#noteItemsEditor .note-item-editor')];
    }
    while (rows.length > Math.max(1, desired.length)) {
      rows.at(-1)?.querySelector('button')?.click();
      rows = [...document.querySelectorAll('#noteItemsEditor .note-item-editor')];
    }
    rows.forEach((row, index) => {
      const item = desired[index] || { text: '', done: false };
      const checkbox = row.querySelector('input[type="checkbox"]');
      const input = row.querySelector('input[type="text"]');
      if (checkbox) {
        checkbox.checked = item.done;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (input) {
        input.value = item.text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  function applyDraft(draft) {
    if (!draft || isSensitiveDraft()) return;
    restoring = true;
    try {
      const typeButton = document.querySelector(`#noteDialog [data-note-type="${draft.kind === 'checklist' ? 'checklist' : 'text'}"]`);
      typeButton?.click();
      setInputValue('#noteTitle', draft.title);
      setInputValue('#noteBody', draft.body);
      const folder = document.querySelector('#noteFolder');
      if (folder && [...folder.options].some(option => option.value === draft.folderId)) {
        folder.value = draft.folderId || '';
        folder.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (draft.kind === 'checklist') restoreChecklistItems(draft.items);
      hideRecovery();
      setStatus('Черновик восстановлен', 'restored');
      requestAnimationFrame(() => document.querySelector('#noteTitle')?.focus());
    } finally {
      restoring = false;
    }
  }

  function discardDraft() {
    clearDraft();
    hideRecovery();
    setStatus('Черновик удалён', 'idle');
  }

  function ensureRecovery() {
    if (recovery) return recovery;
    recovery = document.createElement('div');
    recovery.className = 'notes-editor-recovery hidden';
    recovery.innerHTML = '<div><b>Есть несохранённый черновик</b><span>Заметка изменилась на другом устройстве. Выбери, какую версию продолжить.</span></div><div class="notes-editor-recovery-actions"><button type="button" data-note-draft-discard>Оставить текущую</button><button type="button" class="notes-editor-recovery-confirm" data-note-draft-restore>Восстановить черновик</button></div>';
    dialog?.querySelector('.dialog-head')?.after(recovery);
    recovery.querySelector('[data-note-draft-discard]')?.addEventListener('click', discardDraft);
    recovery.querySelector('[data-note-draft-restore]')?.addEventListener('click', () => applyDraft(readDraft()));
    return recovery;
  }

  function showRecovery() {
    ensureRecovery()?.classList.remove('hidden');
  }

  function hideRecovery() {
    recovery?.classList.add('hidden');
  }

  function ensureUi() {
    const head = dialog?.querySelector('.dialog-head');
    if (!head || status) return;
    status = document.createElement('span');
    status.id = 'noteDraftStatus';
    status.className = 'notes-editor-draft-status';
    status.setAttribute('aria-live', 'polite');
    head.insertBefore(status, head.querySelector('button') || null);
    ensureRecovery();
  }

  function handleDialogOpen() {
    openedNoteId = currentNoteId();
    ensureUi();
    hideRecovery();
    if (isSensitiveDraft()) {
      clearDraft();
      setStatus('Защищённый режим · черновик не хранится', 'protected');
      return;
    }
    const draft = readDraft();
    if (!draft) {
      setStatus('Черновик сохраняется на этом устройстве', 'idle');
      return;
    }
    const id = currentNoteId();
    if (draft.noteId !== id) {
      if (!id && matchesRecentlySavedNewNote(draft)) clearDraft();
      setStatus('Черновик сохраняется на этом устройстве', 'idle');
      return;
    }
    const base = currentBaseNote();
    if (base && sameDraftAsNote(draft, base)) {
      clearDraft();
      setStatus('Все изменения сохранены', 'saved');
      return;
    }
    if (!id) {
      if (matchesRecentlySavedNewNote(draft)) {
        clearDraft();
        setStatus('Все изменения сохранены', 'saved');
      } else applyDraft(draft);
      return;
    }
    if (!base) {
      setStatus('Черновик найден', 'warning');
      showRecovery();
      return;
    }
    if (Number(base.updatedAt || 0) === Number(draft.baseUpdatedAt || 0)) applyDraft(draft);
    else {
      setStatus('Есть две версии заметки', 'warning');
      showRecovery();
    }
  }

  function markDraftClosed() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const draft = readDraft();
    if (!draft) return;
    if (draft.noteId === openedNoteId) {
      draft.wasOpen = false;
      draft.savedAt = Date.now();
      writeDraft(draft);
    }
  }

  function handleDialogClose() {
    markDraftClosed();
    openedNoteId = '';
  }

  function flushOpenDraft() {
    if (!dialog?.open || restoring || isSensitiveDraft()) return;
    persistDraft(true);
  }

  function recoverInterruptedEditor() {
    const draft = readDraft();
    if (!draft?.wasOpen || draft.baseProtected || Date.now() - Number(draft.savedAt || 0) > MAX_AGE_MS) return;
    if (matchesRecentlySavedNewNote(draft)) {
      clearDraft();
      return;
    }
    let note = draft.noteId ? noteById(draft.noteId) : null;
    if (note?.protected) {
      clearDraft();
      return;
    }
    if (draft.noteId && !note) {
      draft.noteId = '';
      draft.baseUpdatedAt = 0;
      draft.savedAt = Date.now();
      writeDraft(draft);
      note = null;
    }
    window.SeverApp?.switchView?.('notes');
    window.SeverNotes?.openNote?.(note || null);
  }

  function bindForm() {
    form.addEventListener('input', scheduleDraft);
    form.addEventListener('change', event => {
      if (event.target?.id === 'noteProtected') {
        if (event.target.checked || currentBaseNote()?.protected) {
          clearDraft();
          setStatus('Защищённый режим · черновик не хранится', 'protected');
          return;
        }
      }
      scheduleDraft();
    });
    form.addEventListener('click', event => {
      if (!event.target.closest('[data-note-type],#addNoteItem,.note-item-editor button')) return;
      const syntheticRestoreAction = restoring;
      setTimeout(() => { if (!syntheticRestoreAction) scheduleDraft(); }, 0);
    });
  }

  function boot(attempt = 0) {
    if (booted) return;
    dialog = document.querySelector('#noteDialog');
    form = document.querySelector('#noteForm');
    if (!dialog || !form || !window.SeverApp || !window.SeverNotes || document.documentElement.dataset.severNotesCore !== 'ready') {
      if (attempt < 160) setTimeout(() => boot(attempt + 1), 50);
      return;
    }
    booted = true;
    ensureUi();
    bindForm();
    // Native dialog `close` is queued. Capture explicit close/cancel intent first
    // so a synchronous read after the dialog disappears cannot still see wasOpen=true.
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-close="noteDialog"]')) markDraftClosed();
    }, true);
    dialog.addEventListener('cancel', markDraftClosed, true);
    dialog.addEventListener('close', handleDialogClose);
    observer = new MutationObserver(() => { if (dialog.open) queueMicrotask(handleDialogOpen); });
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    window.addEventListener('pagehide', flushOpenDraft);
    window.addEventListener('beforeunload', flushOpenDraft);
    document.documentElement.dataset.severNotesEditorFlow = 'ready';
    setTimeout(recoverInterruptedEditor, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
  window.addEventListener('sever:ready', () => { if (!booted) boot(); });
})();
