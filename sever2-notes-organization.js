(function () {
  'use strict';

  const ORGANIZATION_KEY = 'noteOrganization';
  const MAX_TAGS = 5;
  const MAX_TAG_LENGTH = 24;
  let activeTag = '';
  let selectedNoteId = '';
  let observer = null;
  let scheduled = false;
  let repairQueued = false;
  let saveGuardInstalled = false;
  let booted = false;

  function plannerState() {
    return window.SeverApp?.getState?.() || null;
  }

  function noteById(id) {
    return plannerState()?.notes?.find(note => note.id === id) || null;
  }

  function organizationState(create = false) {
    const state = plannerState();
    if (!state) return { v: 1, notes: {} };
    if (!state.profile || typeof state.profile !== 'object' || Array.isArray(state.profile)) {
      if (!create) return { v: 1, notes: {} };
      state.profile = {};
    }
    let organization = state.profile[ORGANIZATION_KEY];
    if (!organization || typeof organization !== 'object' || Array.isArray(organization) || organization.v !== 1 || !organization.notes || typeof organization.notes !== 'object' || Array.isArray(organization.notes)) {
      if (!create) return { v: 1, notes: {} };
      organization = { v: 1, notes: {} };
      state.profile[ORGANIZATION_KEY] = organization;
    }
    return organization;
  }

  function normalizeTag(value) {
    return String(value || '')
      .replace(/^#+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TAG_LENGTH);
  }

  function normalizeTags(values) {
    const seen = new Set();
    const result = [];
    for (const raw of Array.isArray(values) ? values : []) {
      const tag = normalizeTag(raw);
      const key = tag.toLocaleLowerCase('ru-RU');
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      result.push(tag);
      if (result.length >= MAX_TAGS) break;
    }
    return result;
  }

  function metaFor(note, create = false) {
    if (!note?.id) return { pinned: false, tags: [] };
    const organization = organizationState(create);
    let meta = organization.notes[note.id];
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      if (!create) return { pinned: false, tags: [] };
      meta = { pinned: false, tags: [] };
      organization.notes[note.id] = meta;
    }
    const tags = note.protected ? [] : normalizeTags(meta.tags);
    return { pinned: Boolean(meta.pinned), tags };
  }

  function setMeta(note, next) {
    const organization = organizationState(true);
    const current = metaFor(note, true);
    const tags = note.protected ? [] : normalizeTags(next.tags ?? current.tags);
    organization.notes[note.id] = { pinned: Boolean(next.pinned ?? current.pinned), tags };
  }

  function sanitizeOrganization() {
    const state = plannerState();
    const organization = organizationState(false);
    if (!state?.notes || !organization?.notes) return false;
    const live = new Map(state.notes.map(note => [note.id, note]));
    let changed = false;
    Object.keys(organization.notes).forEach(id => {
      const note = live.get(id);
      if (!note) {
        delete organization.notes[id];
        changed = true;
        return;
      }
      const raw = organization.notes[id] || {};
      const clean = { pinned: Boolean(raw.pinned), tags: note.protected ? [] : normalizeTags(raw.tags) };
      if (JSON.stringify(raw) !== JSON.stringify(clean)) {
        organization.notes[id] = clean;
        changed = true;
      }
      if (!clean.pinned && !clean.tags.length) {
        delete organization.notes[id];
        changed = true;
      }
    });
    return changed;
  }

  function installSaveGuard() {
    if (saveGuardInstalled || !window.SeverApp) return;
    const app = window.SeverApp;
    let downstreamHook = typeof app.beforeLocalSave === 'function' ? app.beforeLocalSave : null;
    const guardedHook = function (...args) {
      sanitizeOrganization();
      return downstreamHook?.apply(app, args);
    };
    try {
      Object.defineProperty(app, 'beforeLocalSave', {
        configurable: true,
        enumerable: true,
        get: () => guardedHook,
        set: next => {
          if (next !== guardedHook) downstreamHook = typeof next === 'function' ? next : null;
        }
      });
      saveGuardInstalled = true;
    } catch {
      app.beforeLocalSave = guardedHook;
      saveGuardInstalled = true;
    }
  }

  function queueRepair() {
    if (repairQueued) return;
    repairQueued = true;
    setTimeout(async () => {
      repairQueued = false;
      try {
        if (typeof save === 'function') await save();
      } catch {}
    }, 0);
  }

  async function persistOrganization(message = '') {
    sanitizeOrganization();
    try {
      if (typeof save === 'function') await save();
      window.SeverNotes?.render?.();
      if (message && typeof toast === 'function') toast(message);
    } catch {
      if (typeof toast === 'function') toast('Не удалось сохранить изменения');
    }
  }

  function allTags() {
    const state = plannerState();
    const counts = new Map();
    (state?.notes || []).forEach(note => {
      if (note.protected) return;
      metaFor(note).tags.forEach(tag => {
        const key = tag.toLocaleLowerCase('ru-RU');
        const current = counts.get(key) || { tag, count: 0 };
        current.count += 1;
        counts.set(key, current);
      });
    });
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ru-RU', { sensitivity: 'base' }))
      .map(item => item.tag);
  }

  function ensureShell() {
    const view = document.querySelector('#notesView');
    if (!view || view.dataset.notesOrganizationReady === 'true') return;
    view.dataset.notesOrganizationReady = 'true';

    const summary = document.querySelector('#notesCoreSummary');
    const tags = document.createElement('div');
    tags.id = 'notesOrganizationTags';
    tags.className = 'notes-org-filterbar hidden';
    tags.setAttribute('aria-label', 'Фильтр по тегам');
    summary?.after(tags);

    const pinned = document.createElement('section');
    pinned.id = 'notesPinnedSection';
    pinned.className = 'notes-org-pinned hidden';
    pinned.innerHTML = '<div class="notes-org-pinned-head"><span>Закреплённые</span><b id="notesPinnedCount">0</b></div><div id="notesPinnedList" class="notes-org-pinned-list"></div>';
    document.querySelector('#noteList')?.before(pinned);

    const action = document.createElement('dialog');
    action.id = 'notesActionDialog';
    action.className = 'notes-org-sheet';
    action.innerHTML = '<form method="dialog" class="notes-org-sheet-card"><div class="notes-org-sheet-handle" aria-hidden="true"></div><div class="notes-org-sheet-copy"><b id="notesActionTitle">Заметка</b><span id="notesActionHint">Быстрые действия</span></div><div class="notes-org-sheet-actions"><button type="button" data-notes-action="pin"></button><button type="button" data-notes-action="tags">Теги</button><button type="button" data-notes-action="edit">Открыть и изменить</button></div><button class="notes-org-sheet-cancel" value="cancel">Закрыть</button></form>';
    document.body.appendChild(action);

    const tagDialog = document.createElement('dialog');
    tagDialog.id = 'notesTagDialog';
    tagDialog.className = 'notes-org-tags-dialog';
    tagDialog.innerHTML = '<form method="dialog" class="notes-org-tags-card"><div class="dialog-head"><div><small>ОРГАНИЗАЦИЯ</small><h3>Теги заметки</h3></div><button value="cancel" aria-label="Закрыть">×</button></div><p class="notes-org-tags-help">До 5 тегов. Они нужны только для поиска и группировки заметок.</p><label class="notes-org-tags-input"><span>Теги через запятую</span><input id="notesTagInput" maxlength="140" autocomplete="off" placeholder="Учёба, идеи, работа"></label><div id="notesTagSuggestions" class="notes-org-tag-suggestions"></div><div class="dialog-actions"><button value="cancel">Отмена</button><button id="notesTagSave" class="primary" type="button">Сохранить</button></div></form>';
    document.body.appendChild(tagDialog);

    action.querySelector('[data-notes-action="pin"]')?.addEventListener('click', async () => {
      const note = noteById(selectedNoteId);
      if (!note) return;
      const current = metaFor(note);
      setMeta(note, { pinned: !current.pinned });
      action.close();
      await persistOrganization(current.pinned ? 'Заметка откреплена' : 'Заметка закреплена');
    });
    action.querySelector('[data-notes-action="tags"]')?.addEventListener('click', () => {
      const note = noteById(selectedNoteId);
      if (!note || note.protected) return;
      action.close();
      openTags(note);
    });
    action.querySelector('[data-notes-action="edit"]')?.addEventListener('click', () => {
      const note = noteById(selectedNoteId);
      action.close();
      if (note) window.SeverNotes?.openNote?.(note);
    });
    tagDialog.querySelector('#notesTagSave')?.addEventListener('click', async () => {
      const note = noteById(selectedNoteId);
      if (!note || note.protected) return;
      const input = tagDialog.querySelector('#notesTagInput');
      setMeta(note, { tags: normalizeTags(String(input.value || '').split(',')) });
      tagDialog.close();
      await persistOrganization('Теги сохранены');
    });
  }

  function openActions(note) {
    if (!note) return;
    ensureShell();
    selectedNoteId = note.id;
    const dialog = document.querySelector('#notesActionDialog');
    const meta = metaFor(note);
    const title = (() => {
      if (note.protected) return 'Защищённая заметка';
      try {
        if (typeof visibleNoteData === 'function') return visibleNoteData(note)?.title || note.title || 'Заметка';
      } catch {}
      return note.title || 'Заметка';
    })();
    dialog.querySelector('#notesActionTitle').textContent = title;
    dialog.querySelector('[data-notes-action="pin"]').textContent = meta.pinned ? 'Открепить' : 'Закрепить';
    const tagsButton = dialog.querySelector('[data-notes-action="tags"]');
    tagsButton.disabled = Boolean(note.protected);
    dialog.querySelector('#notesActionHint').textContent = note.protected
      ? 'Теги отключены для защищённых заметок, чтобы не раскрывать их смысл.'
      : 'Закрепи важное или добавь теги.';
    dialog.showModal();
  }

  function openTags(note) {
    if (!note || note.protected) return;
    ensureShell();
    selectedNoteId = note.id;
    const dialog = document.querySelector('#notesTagDialog');
    const input = dialog.querySelector('#notesTagInput');
    input.value = metaFor(note).tags.join(', ');
    renderTagSuggestions(note);
    dialog.showModal();
    requestAnimationFrame(() => input.focus());
  }

  function renderTagSuggestions(note) {
    const root = document.querySelector('#notesTagSuggestions');
    if (!root) return;
    root.textContent = '';
    const current = new Set(metaFor(note).tags.map(tag => tag.toLocaleLowerCase('ru-RU')));
    const suggestions = allTags().filter(tag => !current.has(tag.toLocaleLowerCase('ru-RU'))).slice(0, 8);
    if (!suggestions.length) return;
    const label = document.createElement('span');
    label.className = 'notes-org-suggestions-label';
    label.textContent = 'Частые теги';
    root.appendChild(label);
    suggestions.forEach(tag => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `#${tag}`;
      button.addEventListener('click', () => {
        const input = document.querySelector('#notesTagInput');
        const existing = normalizeTags(String(input.value || '').split(','));
        input.value = normalizeTags([...existing, tag]).join(', ');
      });
      root.appendChild(button);
    });
  }

  function bindGesture(element, note) {
    if (element.dataset.notesOrgGestureBound === 'true') return;
    element.dataset.notesOrgGestureBound = 'true';
    let startX = 0;
    let startY = 0;
    let tracking = false;
    element.addEventListener('touchstart', event => {
      const touch = event.touches?.[0];
      if (!touch) return;
      tracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
    }, { passive: true });
    element.addEventListener('touchend', event => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (dx < -64 && Math.abs(dy) < 46) {
        element.dataset.notesOrgSwiped = 'true';
        openActions(note);
        setTimeout(() => { delete element.dataset.notesOrgSwiped; }, 350);
      }
    }, { passive: true });
    element.addEventListener('click', event => {
      if (element.dataset.notesOrgSwiped !== 'true') return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    element.addEventListener('contextmenu', event => {
      event.preventDefault();
      openActions(note);
    });
    element.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
        event.preventDefault();
        openActions(note);
      }
    });
  }

  function addActionButton(card, note) {
    let button = card.querySelector('.notes-org-action');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'notes-org-action';
      button.setAttribute('aria-label', 'Действия с заметкой');
      button.textContent = '•••';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openActions(note);
      });
      const actions = card.querySelector('.note-card-actions');
      const footer = card.querySelector('.note-card-footer');
      if (actions) actions.prepend(button);
      else footer?.appendChild(button);
    }
  }

  function addTags(card, note) {
    card.querySelector('.notes-org-card-tags')?.remove();
    const tags = metaFor(note).tags;
    if (!tags.length) return;
    const root = document.createElement('div');
    root.className = 'notes-org-card-tags';
    tags.forEach(tag => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `#${tag}`;
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        activeTag = tag;
        renderOrganization();
      });
      root.appendChild(button);
    });
    card.querySelector('.note-card-footer')?.before(root);
  }

  function decorateCards() {
    const root = document.querySelector('#noteList');
    if (!root) return [];
    const cards = [...root.querySelectorAll('.note-card[data-note-id]')];
    cards.forEach(card => {
      const note = noteById(card.dataset.noteId);
      if (!note) return;
      const meta = metaFor(note);
      card.classList.toggle('notes-org-is-pinned', meta.pinned);
      card.dataset.notesOrgTagMatch = activeTag && !meta.tags.some(tag => tag.toLocaleLowerCase('ru-RU') === activeTag.toLocaleLowerCase('ru-RU')) ? 'false' : 'true';
      addActionButton(card, note);
      addTags(card, note);
      bindGesture(card, note);
    });
    return cards;
  }

  function renderFilters() {
    const root = document.querySelector('#notesOrganizationTags');
    if (!root) return;
    const tags = allTags();
    if (activeTag && !tags.some(tag => tag.toLocaleLowerCase('ru-RU') === activeTag.toLocaleLowerCase('ru-RU'))) activeTag = '';
    root.textContent = '';
    root.classList.toggle('hidden', !tags.length);
    if (!tags.length) return;
    const all = document.createElement('button');
    all.type = 'button';
    all.className = activeTag ? '' : 'active';
    all.textContent = 'Все теги';
    all.addEventListener('click', () => { activeTag = ''; renderOrganization(); });
    root.appendChild(all);
    tags.forEach(tag => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = activeTag.toLocaleLowerCase('ru-RU') === tag.toLocaleLowerCase('ru-RU') ? 'active' : '';
      button.textContent = `#${tag}`;
      button.addEventListener('click', () => { activeTag = tag; renderOrganization(); });
      root.appendChild(button);
    });
  }

  function noteTitle(note) {
    if (note.protected) return 'Защищённая заметка';
    try {
      if (typeof visibleNoteData === 'function') return visibleNoteData(note)?.title || note.title || 'Без названия';
    } catch {}
    return note.title || 'Без названия';
  }

  function renderPinned(cards) {
    const section = document.querySelector('#notesPinnedSection');
    const list = document.querySelector('#notesPinnedList');
    const count = document.querySelector('#notesPinnedCount');
    if (!section || !list || !count) return;
    list.textContent = '';
    const visibleIds = new Set(cards.map(card => card.dataset.noteId));
    const pinned = (plannerState()?.notes || [])
      .filter(note => visibleIds.has(note.id) && metaFor(note).pinned)
      .filter(note => !activeTag || metaFor(note).tags.some(tag => tag.toLocaleLowerCase('ru-RU') === activeTag.toLocaleLowerCase('ru-RU')))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

    count.textContent = String(pinned.length);
    section.classList.toggle('hidden', !pinned.length);
    pinned.forEach(note => {
      const row = document.createElement('article');
      row.className = 'notes-org-pinned-row';
      row.tabIndex = 0;
      row.dataset.noteId = note.id;
      const meta = metaFor(note);
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'notes-org-pinned-open';
      const title = document.createElement('b');
      title.textContent = noteTitle(note);
      const sub = document.createElement('span');
      sub.textContent = note.protected ? 'Защищено паролем' : meta.tags.length ? meta.tags.map(tag => `#${tag}`).join(' · ') : (note.kind === 'checklist' ? 'Чек-лист' : 'Заметка');
      main.append(title, sub);
      main.addEventListener('click', () => window.SeverNotes?.openNote?.(note));
      const actions = document.createElement('button');
      actions.type = 'button';
      actions.className = 'notes-org-pinned-action';
      actions.textContent = '•••';
      actions.setAttribute('aria-label', 'Действия с закреплённой заметкой');
      actions.addEventListener('click', () => openActions(note));
      row.append(main, actions);
      bindGesture(row, note);
      list.appendChild(row);
    });
  }

  function applyCardVisibility(cards) {
    cards.forEach(card => {
      const note = noteById(card.dataset.noteId);
      const pinned = note ? metaFor(note).pinned : false;
      const tagMatch = card.dataset.notesOrgTagMatch !== 'false';
      card.classList.toggle('notes-org-hidden-original', pinned || !tagMatch);
    });
    document.querySelectorAll('#noteList .notes-core-group').forEach(group => {
      const anyVisible = [...group.querySelectorAll('.note-card')].some(card => !card.classList.contains('notes-org-hidden-original'));
      group.classList.toggle('notes-org-group-hidden', !anyVisible);
    });
  }

  function renderOrganization() {
    scheduled = false;
    ensureShell();
    const root = document.querySelector('#noteList');
    if (!root) return;
    if (!root.querySelector('.notes-core-group-panel') && root.querySelector('.note-card')) {
      scheduleOrganization();
      return;
    }
    if (sanitizeOrganization()) queueRepair();
    renderFilters();
    const cards = decorateCards();
    applyCardVisibility(cards);
    renderPinned(cards);
  }

  function scheduleOrganization() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(renderOrganization));
  }

  function observeNotes() {
    const root = document.querySelector('#noteList');
    if (!root || observer) return;
    observer = new MutationObserver(scheduleOrganization);
    observer.observe(root, { childList: true, subtree: false });
  }

  function boot(attempt = 0) {
    if (booted) return;
    if (!window.SeverApp || !window.SeverNotes || !document.querySelector('#notesView')) {
      if (attempt < 120) setTimeout(() => boot(attempt + 1), 50);
      return;
    }
    booted = true;
    installSaveGuard();
    ensureShell();
    observeNotes();
    scheduleOrganization();
    document.documentElement.dataset.severNotesOrganization = 'ready';
    window.SeverNotesOrganization = Object.freeze({
      openActions,
      openTags,
      getMeta: noteId => metaFor(noteById(noteId)),
      getActiveTag: () => activeTag,
      sanitizeBeforeSave: sanitizeOrganization
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
  window.addEventListener('sever:ready', () => { if (!booted) boot(); else scheduleOrganization(); });
})();
