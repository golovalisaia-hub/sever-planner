(function () {
  'use strict';

  const SORT_KEY = 'sever-notes-core-sort-v1';
  const FILTERS = new Set(['all', 'text', 'checklist', 'protected']);
  const SORTS = new Set(['updated', 'created', 'title']);
  let currentFilter = 'all';
  let currentSort = readSort();
  let listObserver = null;
  let scheduled = false;
  let booted = false;

  function readSort() {
    try {
      const value = localStorage.getItem(SORT_KEY) || 'updated';
      return SORTS.has(value) ? value : 'updated';
    } catch {
      return 'updated';
    }
  }

  function writeSort(value) {
    try { localStorage.setItem(SORT_KEY, value); } catch {}
  }

  function plannerState() {
    return window.SeverApp?.getState?.() || null;
  }

  function notesContext() {
    return window.SeverNotes?.getContext?.() || { activeFolderId: 'all' };
  }

  function dataFor(note) {
    if (!note) return null;
    try {
      if (typeof visibleNoteData === 'function') return visibleNoteData(note);
    } catch {}
    return note.protected ? null : note;
  }

  function titleFor(note) {
    const data = dataFor(note);
    return data?.title || (note?.protected ? 'Закрытая заметка' : 'Без названия');
  }

  function kindFor(note) {
    if (note?.protected && !dataFor(note)) return 'protected';
    return dataFor(note)?.kind || note?.kind || 'text';
  }

  function inActiveFolder(note) {
    const active = notesContext().activeFolderId || 'all';
    if (active === 'all') return true;
    if (active === 'none') return !note.folderId;
    return note.folderId === active;
  }

  function matchesSearch(note) {
    const query = (document.querySelector('#noteSearch')?.value || '').trim().toLocaleLowerCase('ru-RU');
    if (!query) return true;
    const data = dataFor(note);
    if (note.protected && !data) return true;
    const haystack = `${data?.title || ''}\n${data?.body || ''}\n${(data?.items || []).map(item => item.text).join(' ')}`.toLocaleLowerCase('ru-RU');
    return haystack.includes(query);
  }

  function baseVisibleNotes() {
    const state = plannerState();
    if (!state?.notes) return [];
    return state.notes
      .filter(note => inActiveFolder(note) && matchesSearch(note))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }

  function matchesFilter(note) {
    if (currentFilter === 'all') return true;
    if (currentFilter === 'protected') return Boolean(note.protected);
    return kindFor(note) === currentFilter;
  }

  function sortPairs(pairs) {
    const copy = [...pairs];
    if (currentSort === 'title') {
      return copy.sort((left, right) => titleFor(left.note).localeCompare(titleFor(right.note), 'ru-RU', { sensitivity: 'base' }));
    }
    const field = currentSort === 'created' ? 'createdAt' : 'updatedAt';
    return copy.sort((left, right) => Number(right.note?.[field] || 0) - Number(left.note?.[field] || 0));
  }

  function dateGroup(timestamp) {
    if (currentSort === 'title') return 'По названию';
    const value = Number(timestamp || 0);
    if (!value) return 'Ранее';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = new Date(value);
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const diff = Math.round((today - dayStart) / 86400000);
    if (diff <= 0) return 'Сегодня';
    if (diff === 1) return 'Вчера';
    if (diff <= 7) return 'Последние 7 дней';
    return 'Ранее';
  }

  function iconEditButton(button) {
    if (!button || button.dataset.notesCoreIcon === 'true') return;
    button.dataset.notesCoreIcon = 'true';
    button.setAttribute('aria-label', 'Изменить заметку');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14 8 3 3"/></svg>';
  }

  function decorateCard(card, note) {
    if (!card || !note) return;
    card.dataset.noteId = note.id || '';
    card.classList.add('notes-core-card');
    card.tabIndex = 0;
    card.setAttribute('aria-label', `Открыть заметку «${titleFor(note)}»`);

    iconEditButton(card.querySelector('.note-edit'));

    const items = dataFor(note)?.items || [];
    const checklist = card.querySelector('.note-checklist');
    if (checklist && items.length > 2) {
      let more = card.querySelector('.notes-core-more-items');
      if (!more) {
        more = document.createElement('span');
        more.className = 'notes-core-more-items';
        checklist.after(more);
      }
      more.textContent = `Ещё ${items.length - 2}`;
    }

    if (card.dataset.notesCoreBound === 'true') return;
    card.dataset.notesCoreBound = 'true';
    card.addEventListener('click', event => {
      if (event.target.closest('button,input,label,select,textarea,a')) return;
      window.SeverNotes?.openNote?.(note);
    });
    card.addEventListener('keydown', event => {
      if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      window.SeverNotes?.openNote?.(note);
    });
  }

  function updateSummary(visibleCount) {
    const state = plannerState();
    const summary = document.querySelector('#notesCoreSummary');
    if (!summary || !state?.notes) return;
    const folderNotes = state.notes.filter(inActiveFolder);
    const checklists = folderNotes.filter(note => kindFor(note) === 'checklist').length;
    const protectedCount = folderNotes.filter(note => note.protected).length;
    const parts = [`${visibleCount} ${visibleCount === 1 ? 'запись' : visibleCount > 1 && visibleCount < 5 ? 'записи' : 'записей'}`];
    if (checklists) parts.push(`${checklists} чек-лист${checklists === 1 ? '' : 'а'}`);
    if (protectedCount) parts.push(`${protectedCount} защищ.`);
    summary.textContent = parts.join(' · ');
  }

  function reconnectObserver(root) {
    if (!listObserver || !root) return;
    listObserver.observe(root, { childList: true, subtree: false });
  }

  function applyPresentation() {
    scheduled = false;
    ensureControls();
    const root = document.querySelector('#noteList');
    if (!root) return;

    const cards = [...root.querySelectorAll(':scope > .note-card')];
    if (!cards.length) {
      updateSummary(0);
      return;
    }

    const notes = baseVisibleNotes();
    const pairs = cards.map((card, index) => ({ card, note: notes[index] })).filter(pair => pair.note);
    const visible = sortPairs(pairs.filter(pair => matchesFilter(pair.note)));

    listObserver?.disconnect();
    root.textContent = '';
    root.classList.add('notes-core-list');

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'notes-core-empty';
      empty.innerHTML = '<b>Ничего не найдено</b><span>Смени фильтр или запрос поиска.</span>';
      root.appendChild(empty);
      updateSummary(0);
      reconnectObserver(root);
      return;
    }

    const field = currentSort === 'created' ? 'createdAt' : 'updatedAt';
    const groups = new Map();
    visible.forEach(pair => {
      const key = dateGroup(pair.note?.[field]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(pair);
    });

    groups.forEach((groupPairs, label) => {
      const group = document.createElement('section');
      group.className = 'notes-core-group';
      group.setAttribute('aria-label', label);
      const heading = document.createElement('div');
      heading.className = 'notes-core-group-title';
      heading.textContent = label;
      group.appendChild(heading);
      const panel = document.createElement('div');
      panel.className = 'notes-core-group-panel';
      groupPairs.forEach(pair => {
        decorateCard(pair.card, pair.note);
        panel.appendChild(pair.card);
      });
      group.appendChild(panel);
      root.appendChild(group);
    });

    updateSummary(visible.length);
    reconnectObserver(root);
  }

  function schedulePresentation() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(applyPresentation);
  }

  async function saveQuickNote(text) {
    const value = text.trim();
    if (!value) return;
    const state = plannerState();
    if (!state?.notes) return;
    const active = notesContext().activeFolderId || 'all';
    const folderId = active !== 'all' && active !== 'none' ? active : '';
    const now = Date.now();
    const id = globalThis.crypto?.randomUUID?.() || `${now.toString(36)}${Math.random().toString(36).slice(2)}`;
    state.notes.push({
      id,
      folderId,
      title: value.slice(0, 100),
      body: value.length > 100 ? value : '',
      kind: 'text',
      items: [],
      done: false,
      protected: false,
      createdAt: now,
      updatedAt: now
    });
    try {
      if (typeof clearSyncTombstone === 'function') clearSyncTombstone('notes', id);
      if (typeof save === 'function') await save();
      window.SeverNotes?.render?.();
      if (typeof toast === 'function') toast('Заметка сохранена');
    } catch {
      state.notes = state.notes.filter(note => note.id !== id);
      if (typeof toast === 'function') toast('Не удалось сохранить заметку');
    }
  }

  function ensureControls() {
    const view = document.querySelector('#notesView');
    if (!view || view.dataset.notesCoreReady === 'true') return;
    view.dataset.notesCoreReady = 'true';

    const intro = view.querySelector('.view-intro');
    if (intro) intro.textContent = 'Быстрые мысли, списки и важные записи — без лишних действий.';

    const capture = document.createElement('form');
    capture.className = 'notes-core-capture';
    capture.id = 'notesQuickCapture';
    capture.innerHTML = '<span class="notes-core-capture-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span><input id="notesQuickCaptureInput" maxlength="160" autocomplete="off" placeholder="Быстрая заметка…" aria-label="Быстрая заметка"><button type="submit">Записать</button><button class="notes-core-expand" type="button" aria-label="Открыть полный редактор"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-7 7M10 19H5v-5M5 19l7-7"/></svg></button>';
    const search = view.querySelector('.note-search');
    view.insertBefore(capture, search || view.querySelector('#folderTabs'));

    capture.addEventListener('submit', async event => {
      event.preventDefault();
      const input = capture.querySelector('#notesQuickCaptureInput');
      const text = input.value;
      input.value = '';
      await saveQuickNote(text);
      input.focus();
    });
    capture.querySelector('.notes-core-expand')?.addEventListener('click', () => window.SeverNotes?.openNote?.());

    const folderTabs = view.querySelector('#folderTabs');
    const controls = document.createElement('div');
    controls.className = 'notes-core-controls';
    controls.innerHTML = '<div class="notes-core-filters" role="group" aria-label="Фильтр заметок"><button type="button" class="active" data-notes-core-filter="all">Все</button><button type="button" data-notes-core-filter="text">Заметки</button><button type="button" data-notes-core-filter="checklist">Чек-листы</button><button type="button" data-notes-core-filter="protected">Защищённые</button></div><label class="notes-core-sort"><span class="visually-hidden">Сортировка заметок</span><select id="notesCoreSort" aria-label="Сортировка заметок"><option value="updated">Последние</option><option value="created">Созданные</option><option value="title">А–Я</option></select><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9l4 4 4-4"/></svg></label>';
    folderTabs?.after(controls);

    const summary = document.createElement('div');
    summary.id = 'notesCoreSummary';
    summary.className = 'notes-core-summary';
    controls.after(summary);

    controls.querySelectorAll('[data-notes-core-filter]').forEach(button => {
      button.addEventListener('click', () => {
        const next = button.dataset.notesCoreFilter;
        if (!FILTERS.has(next)) return;
        currentFilter = next;
        controls.querySelectorAll('[data-notes-core-filter]').forEach(item => item.classList.toggle('active', item === button));
        window.SeverNotes?.render?.();
      });
    });

    const sort = controls.querySelector('#notesCoreSort');
    sort.value = currentSort;
    sort.addEventListener('change', () => {
      currentSort = SORTS.has(sort.value) ? sort.value : 'updated';
      writeSort(currentSort);
      window.SeverNotes?.render?.();
    });

    const editorHint = document.querySelector('#checklistEditor .checklist-editor-head span');
    if (editorHint) editorHint.textContent = 'Отмечай пункты по мере выполнения.';
  }

  function observeList() {
    const root = document.querySelector('#noteList');
    if (!root || listObserver) return;
    listObserver = new MutationObserver(schedulePresentation);
    reconnectObserver(root);
  }

  function boot(attempt = 0) {
    if (booted) return;
    if (!window.SeverApp || !window.SeverNotes || !document.querySelector('#notesView')) {
      if (attempt < 120) setTimeout(() => boot(attempt + 1), 50);
      return;
    }
    booted = true;
    ensureControls();
    observeList();
    schedulePresentation();
    document.documentElement.dataset.severNotesCore = 'ready';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
  window.addEventListener('sever:ready', () => { if (!booted) boot(); else schedulePresentation(); });
})();
