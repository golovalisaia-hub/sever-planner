(function () {
  'use strict';

  let booted = false;
  let sheet = null;
  let scopeBar = null;
  let sourceObserver = null;
  let activeMode = 'folders';

  function folderSource() {
    return document.querySelector('#folderTabs');
  }

  function tagSource() {
    return document.querySelector('#notesOrganizationTags');
  }

  function sourceButtons(root) {
    return root ? [...root.querySelectorAll(':scope > button')] : [];
  }

  function activeFolderButton() {
    return folderSource()?.querySelector(':scope > button.active') || sourceButtons(folderSource())[0] || null;
  }

  function activeTagButton() {
    return tagSource()?.querySelector(':scope > button.active') || null;
  }

  function folderLabel(button) {
    return button?.querySelector('span')?.textContent?.trim() || button?.textContent?.trim() || 'Все';
  }

  function folderCount(button) {
    return button?.querySelector('b')?.textContent?.trim() || '';
  }

  function tagLabel(button) {
    const value = button?.textContent?.trim() || 'Все теги';
    return value === 'Все теги' ? value : value.replace(/^#/, '');
  }

  function currentTag() {
    const button = activeTagButton();
    if (!button || button === sourceButtons(tagSource())[0]) return '';
    return tagLabel(button);
  }

  function isDefaultFolder() {
    return activeFolderButton() === sourceButtons(folderSource())[0];
  }

  function clickSource(button) {
    if (!button) return;
    button.click();
    requestAnimationFrame(() => requestAnimationFrame(updateScopeBar));
  }

  function icon(name) {
    if (name === 'folder') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l1.8 2h9.2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z"/><path d="M3.5 7.5V6a2 2 0 0 1 2-2h3.4l1.8 2h7.8a2 2 0 0 1 2 2v1.5"/></svg>';
    if (name === 'tag') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v6.2L12.8 20a2 2 0 0 0 2.8 0l4.4-4.4a2 2 0 0 0 0-2.8L11.2 4H5a1 1 0 0 0-1 1Z"/><circle cx="8" cy="8" r="1.3"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  }

  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement('dialog');
    sheet.id = 'notesNavigatorDialog';
    sheet.className = 'notes-navigation-sheet';
    sheet.innerHTML = '<form method="dialog" class="notes-navigation-sheet-card"><div class="notes-navigation-sheet-handle" aria-hidden="true"></div><div class="notes-navigation-sheet-head"><div><small id="notesNavigatorEyebrow">ОРГАНИЗАЦИЯ</small><h3 id="notesNavigatorTitle">Папки</h3></div><button value="cancel" aria-label="Закрыть">×</button></div><div id="notesNavigatorList" class="notes-navigation-sheet-list"></div><div id="notesNavigatorFooter" class="notes-navigation-sheet-footer"></div></form>';
    document.body.appendChild(sheet);
    return sheet;
  }

  function buildSourceRow(button, index, mode) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'notes-navigation-option';
    row.dataset.notesNavigationIndex = String(index);
    row.dataset.notesNavigationMode = mode;
    const active = button.classList.contains('active');
    row.classList.toggle('active', active);
    row.setAttribute('aria-pressed', String(active));

    const label = document.createElement('span');
    label.className = 'notes-navigation-option-label';
    label.textContent = mode === 'folders' ? folderLabel(button) : (index === 0 ? 'Все теги' : `#${tagLabel(button)}`);
    const meta = document.createElement('span');
    meta.className = 'notes-navigation-option-meta';
    if (mode === 'folders') meta.textContent = folderCount(button) ? `${folderCount(button)} заметок` : '';
    else meta.textContent = active ? 'Выбрано' : '';
    const check = document.createElement('span');
    check.className = 'notes-navigation-option-check';
    check.textContent = active ? '✓' : '';
    row.append(label, meta, check);
    row.addEventListener('click', () => {
      const source = mode === 'folders' ? sourceButtons(folderSource()) : sourceButtons(tagSource());
      clickSource(source[index]);
      sheet.close();
    });
    return row;
  }

  function renderSheet(mode) {
    activeMode = mode === 'tags' ? 'tags' : 'folders';
    const dialog = ensureSheet();
    dialog.querySelector('#notesNavigatorTitle').textContent = activeMode === 'folders' ? 'Папки' : 'Теги';
    dialog.querySelector('#notesNavigatorEyebrow').textContent = activeMode === 'folders' ? 'ГДЕ ИСКАТЬ' : 'БЫСТРЫЙ ФИЛЬТР';
    const list = dialog.querySelector('#notesNavigatorList');
    const footer = dialog.querySelector('#notesNavigatorFooter');
    list.textContent = '';
    footer.textContent = '';

    const source = activeMode === 'folders' ? sourceButtons(folderSource()) : sourceButtons(tagSource());
    if (!source.length) {
      const empty = document.createElement('div');
      empty.className = 'notes-navigation-sheet-empty';
      empty.innerHTML = activeMode === 'tags'
        ? '<b>Тегов пока нет</b><span>Добавь тег через меню ••• у обычной заметки.</span>'
        : '<b>Папок пока нет</b><span>Создай папку, чтобы разделить записи по темам.</span>';
      list.appendChild(empty);
    } else {
      source.forEach((button, index) => list.appendChild(buildSourceRow(button, index, activeMode)));
    }

    if (activeMode === 'folders') {
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = 'Новая папка';
      add.addEventListener('click', () => {
        dialog.close();
        document.querySelector('#openFolder')?.click();
      });
      footer.appendChild(add);
      if (!isDefaultFolder() && activeFolderButton() !== sourceButtons(folderSource())[1]) {
        const manage = document.createElement('button');
        manage.type = 'button';
        manage.textContent = 'Управлять текущей';
        manage.addEventListener('click', () => {
          dialog.close();
          document.querySelector('#manageFolder')?.click();
        });
        footer.appendChild(manage);
      }
    }
  }

  function openSheet(mode) {
    renderSheet(mode);
    const dialog = ensureSheet();
    if (!dialog.open) dialog.showModal();
  }

  function updateScopeBar() {
    if (!scopeBar) return;
    const folder = activeFolderButton();
    const tag = currentTag();
    const folderButton = scopeBar.querySelector('[data-notes-scope="folder"]');
    const tagButton = scopeBar.querySelector('[data-notes-scope="tag"]');
    const reset = scopeBar.querySelector('[data-notes-scope-reset]');
    const tagButtons = sourceButtons(tagSource());

    folderButton.querySelector('b').textContent = folderLabel(folder);
    const count = folderCount(folder);
    folderButton.querySelector('small').textContent = count ? `${count} записей` : 'Папка';
    tagButton.querySelector('b').textContent = tag ? `#${tag}` : 'Теги';
    tagButton.querySelector('small').textContent = tag ? 'Фильтр активен' : (tagButtons.length > 1 ? `${tagButtons.length - 1} доступно` : 'Нет тегов');
    tagButton.classList.toggle('active', Boolean(tag));
    tagButton.disabled = tagButtons.length <= 1;
    reset.classList.toggle('hidden', isDefaultFolder() && !tag);
  }

  function clearScopes() {
    const folder = sourceButtons(folderSource())[0];
    const tags = sourceButtons(tagSource())[0];
    if (folder && !isDefaultFolder()) folder.click();
    if (tags && currentTag()) tags.click();
    requestAnimationFrame(() => requestAnimationFrame(updateScopeBar));
  }

  function ensureUi() {
    const view = document.querySelector('#notesView');
    const search = view?.querySelector('.note-search');
    const folders = folderSource();
    if (!view || !search || !folders || view.querySelector('#notesNavigationSticky')) return;

    folders.classList.add('notes-navigation-source');
    tagSource()?.classList.add('notes-navigation-source');

    const sticky = document.createElement('div');
    sticky.id = 'notesNavigationSticky';
    sticky.className = 'notes-navigation-sticky';
    search.before(sticky);
    sticky.appendChild(search);

    scopeBar = document.createElement('div');
    scopeBar.id = 'notesNavigationScopes';
    scopeBar.className = 'notes-navigation-scopes';
    scopeBar.innerHTML = `<button type="button" data-notes-scope="folder" aria-label="Выбрать папку">${icon('folder')}<span><small>Папка</small><b>Все</b></span><i aria-hidden="true">⌄</i></button><button type="button" data-notes-scope="tag" aria-label="Выбрать тег">${icon('tag')}<span><small>Нет тегов</small><b>Теги</b></span><i aria-hidden="true">⌄</i></button><button type="button" class="notes-navigation-reset hidden" data-notes-scope-reset aria-label="Сбросить папку и тег">${icon('close')}</button>`;
    sticky.appendChild(scopeBar);

    scopeBar.querySelector('[data-notes-scope="folder"]').addEventListener('click', () => openSheet('folders'));
    scopeBar.querySelector('[data-notes-scope="tag"]').addEventListener('click', () => openSheet('tags'));
    scopeBar.querySelector('[data-notes-scope-reset]').addEventListener('click', clearScopes);

    const sourceNodes = [folders, tagSource()].filter(Boolean);
    sourceObserver = new MutationObserver(() => requestAnimationFrame(updateScopeBar));
    sourceNodes.forEach(node => sourceObserver.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }));
    updateScopeBar();
  }

  function boot(attempt = 0) {
    if (booted) return;
    const coreReady = document.documentElement.dataset.severNotesCore === 'ready';
    const orgReady = document.documentElement.dataset.severNotesOrganization === 'ready';
    if (!window.SeverApp || !window.SeverNotes || !coreReady || !orgReady || !folderSource()) {
      if (attempt < 180) setTimeout(() => boot(attempt + 1), 50);
      return;
    }
    booted = true;
    ensureSheet();
    ensureUi();
    document.documentElement.dataset.severNotesNavigation = 'ready';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
  window.addEventListener('sever:ready', () => { if (!booted) boot(); else updateScopeBar(); });
})();
