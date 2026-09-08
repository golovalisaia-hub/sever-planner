(() => {
  const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
  const ROOT_SELECTOR = 'dialog, .view';
  const records = new Map();

  const rootId = root => root?.id || '';
  const fieldKey = (field, index) => field.id || field.name || `${field.tagName.toLocaleLowerCase('en-US')}:${index}`;
  const readField = field => {
    if (field.matches('[contenteditable="true"]')) return { kind: 'content', value: field.textContent || '' };
    if (field.type === 'checkbox' || field.type === 'radio') return { kind: 'checked', value: Boolean(field.checked) };
    return { kind: 'value', value: field.value };
  };
  const writeField = (field, snapshot) => {
    if (!snapshot) return;
    if (snapshot.kind === 'content') field.textContent = snapshot.value;
    else if (snapshot.kind === 'checked') field.checked = Boolean(snapshot.value);
    else field.value = snapshot.value;
  };
  const recordFor = root => {
    const id = rootId(root);
    if (!id) return null;
    if (!records.has(id)) records.set(id, { dirty: false, conflict: false, domain: '', entityId: '' });
    return records.get(id);
  };
  const activeRoot = element => element?.closest?.(ROOT_SELECTOR) || null;

  function begin(id, meta = {}) {
    const root = document.getElementById(id);
    const record = root && recordFor(root);
    if (!record) return;
    Object.assign(record, { dirty: false, conflict: false, domain: meta.domain || '', entityId: meta.entityId || '', storageScope: window.SeverApp?.getStorageScope?.() });
    root.querySelector('.draft-conflict')?.remove();
  }

  function clear(id) {
    const record = records.get(id);
    if (record) Object.assign(record, { dirty: false, conflict: false, domain: '', entityId: '' });
    document.getElementById(id)?.querySelector('.draft-conflict')?.remove();
  }

  function markDirty(event) {
    const root = activeRoot(event.target);
    const record = root && recordFor(root);
    if (record) record.dirty = true;
  }

  function capture() {
    const roots = [];
    records.forEach((record, id) => {
      if (!record.dirty) return;
      const root = document.getElementById(id);
      if (!root || root.matches('dialog:not([open])') || root.matches('.view:not(.active)')) return;
      const fields = {};
      [...root.querySelectorAll(FIELD_SELECTOR)].forEach((field, index) => { fields[fieldKey(field, index)] = readField(field); });
      roots.push({ id, fields, scrollTop: root.scrollTop, record: { ...record } });
    });
    const focused = document.activeElement;
    const focus = focused && focused !== document.body ? {
      id: focused.id || '',
      rootId: rootId(activeRoot(focused)),
      key: fieldKey(focused, [...(activeRoot(focused)?.querySelectorAll(FIELD_SELECTOR) || [])].indexOf(focused)),
      start: typeof focused.selectionStart === 'number' ? focused.selectionStart : null,
      end: typeof focused.selectionEnd === 'number' ? focused.selectionEnd : null,
      direction: focused.selectionDirection || 'none'
    } : null;
    return { roots, focus, scrollX: window.scrollX, scrollY: window.scrollY };
  }

  function restore(snapshot) {
    if (!snapshot) return;
    snapshot.roots.forEach(saved => {
      const root = document.getElementById(saved.id);
      const record = records.get(saved.id);
      if (!root || !record?.dirty) return;
      [...root.querySelectorAll(FIELD_SELECTOR)].forEach((field, index) => writeField(field, saved.fields[fieldKey(field, index)]));
      root.scrollTop = saved.scrollTop;
    });
    const focus = snapshot.focus;
    if (focus) {
      const root = focus.rootId ? document.getElementById(focus.rootId) : document;
      const fields = [...(root?.querySelectorAll?.(FIELD_SELECTOR) || [])];
      const target = focus.id ? document.getElementById(focus.id) : fields.find((field, index) => fieldKey(field, index) === focus.key);
      if (target && document.activeElement !== target) target.focus({ preventScroll: true });
      if (target && focus.start !== null && typeof target.setSelectionRange === 'function') {
        const length = String(target.value || '').length;
        target.setSelectionRange(Math.min(focus.start, length), Math.min(focus.end ?? focus.start, length), focus.direction);
      }
    }
    window.scrollTo(snapshot.scrollX, snapshot.scrollY);
  }

  function markRemoteConflicts(recordIds = {}) {
    records.forEach((record, id) => {
      if (!record.dirty || !record.domain || !record.entityId || !recordIds[record.domain]?.includes(record.entityId)) return;
      record.conflict = true;
      const root = document.getElementById(id);
      if (!root || root.querySelector('.draft-conflict')) return;
      const notice = document.createElement('p');
      notice.className = 'draft-conflict';
      notice.setAttribute('role', 'status');
      notice.textContent = 'На другом устройстве эта запись изменилась. Ваш текст сохранён; после сохранения он станет текущей версией.';
      root.querySelector('form, .dialog-head')?.append?.(notice);
    });
  }

  function consumeConflict(id) {
    const record = records.get(id);
    const conflict = Boolean(record?.conflict);
    clear(id);
    return conflict;
  }

  // Keep drafts in place, but never submit one into a different account.
  document.addEventListener('submit', event => {
    const root = activeRoot(event.target), record = root && records.get(root.id);
    if (!record?.storageScope || record.storageScope === window.SeverApp?.getStorageScope?.()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (root.querySelector('.scope-conflict')) return;
    const notice = document.createElement('p'); notice.className = 'scope-conflict'; notice.setAttribute('role', 'alert');
    notice.textContent = 'Аккаунт изменился. Черновик оставлен здесь, но сохранение заблокировано. Вернитесь в исходный аккаунт или скопируйте текст.';
    event.target.appendChild(notice);
  }, true);
  document.addEventListener('input', markDirty, true);
  document.addEventListener('change', markDirty, true);
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => {
    if (!dialog.dataset.preserveDraftOnClose) clear(dialog.id);
  }));

  window.SeverUiState = Object.freeze({ begin, clear, capture, restore, markRemoteConflicts, consumeConflict, isDirty: id => Boolean(records.get(id)?.dirty), hasDirtyDrafts: () => [...records.values()].some(record => record.dirty) });
})();
