import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { randomUUID, webcrypto } from 'node:crypto';
import { changedCollections as detectChangedCollections, changedRecordIds as detectChangedRecordIds } from '../js/sync-core.mjs';

const root = path.resolve(import.meta.dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const notesSource = fs.readFileSync(path.join(root, 'notes-pro.js'), 'utf8');
const cloudSource = fs.readFileSync(path.join(root, 'js', 'cloud-runtime.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const uiStatePath = path.join(root, 'js', 'ui-state.js');
const uiStateSource = fs.existsSync(uiStatePath) ? fs.readFileSync(uiStatePath, 'utf8') : '';

const clone = value => JSON.parse(JSON.stringify(value));

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
    this.defaultPrevented = false;
    this.target = init.target || null;
    this.currentTarget = null;
  }

  preventDefault() { this.defaultPrevented = true; }
}

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, once: Boolean(options?.once) });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.listener !== listener));
  }

  dispatchEvent(event) {
    if (!event?.type) throw new TypeError('Event type is required');
    if (!event.target) event.target = this;
    event.currentTarget = this;
    const entries = [...(this.listeners.get(event.type) || [])];
    for (const entry of entries) {
      entry.listener.call(this, event);
      if (entry.once) this.removeEventListener(event.type, entry.listener);
    }
    return !event.defaultPrevented;
  }
}

class FakeClassList {
  constructor(owner) { this.owner = owner; }

  values() { return new Set(this.owner.className.split(/\s+/).filter(Boolean)); }
  contains(name) { return this.values().has(name); }

  write(values) {
    this.owner.className = [...values].join(' ');
  }

  add(...names) {
    const values = this.values();
    names.forEach(name => values.add(name));
    this.write(values);
  }

  remove(...names) {
    const values = this.values();
    names.forEach(name => values.delete(name));
    this.write(values);
  }

  toggle(name, force) {
    const values = this.values();
    const enabled = force === undefined ? !values.has(name) : Boolean(force);
    if (enabled) values.add(name); else values.delete(name);
    this.write(values);
    return enabled;
  }
}

class FakeStyle {
  constructor(owner) {
    this.owner = owner;
    return new Proxy(this, {
      set: (target, property, value) => {
        if (!['owner'].includes(property) && target[property] !== value) owner.record(`style.${String(property)}`);
        target[property] = value;
        return true;
      }
    });
  }

  setProperty(name, value) { this[name] = value; }
}

class FakeNode extends FakeEventTarget {
  constructor(document, tagName = 'div', id = '') {
    super();
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.parentNode = null;
    this.childNodes = [];
    this.dataset = {};
    this.attributes = new Map();
    this._className = '';
    this._innerHTML = '';
    this._textContent = '';
    this._value = '';
    this.checked = false;
    this.disabled = false;
    this.open = false;
    this.type = '';
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.selectionDirection = 'none';
    this.offsetWidth = 80;
    this.offsetHeight = 40;
    this.offsetLeft = 0;
    this.offsetTop = 0;
    this.classList = new FakeClassList(this);
    this.style = new FakeStyle(this);
  }

  record(kind) { this.ownerDocument?.recordMutation(this, kind); }

  get className() { return this._className; }
  set className(value) {
    const next = String(value ?? '');
    if (next !== this._className) this.record('className');
    this._className = next;
  }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) {
    const next = String(value ?? '');
    if (next !== this._innerHTML || this.childNodes.length) this.record('innerHTML');
    this._innerHTML = next;
    this.childNodes = [];
  }

  get textContent() { return this._textContent; }
  set textContent(value) {
    const next = String(value ?? '');
    if (next !== this._textContent || this.childNodes.length) this.record('textContent');
    this._textContent = next;
    this.childNodes = [];
  }

  get value() { return this._value; }
  set value(value) {
    const next = String(value ?? '');
    if (next !== this._value) this.record('value');
    this._value = next;
    this.selectionStart = next.length;
    this.selectionEnd = next.length;
    this.selectionDirection = 'none';
  }

  get children() { return this.childNodes.filter(node => node instanceof FakeNode); }
  get firstElementChild() { return this.children[0] || null; }

  setAttribute(name, value) {
    const next = String(value);
    if (this.attributes.get(name) !== next) this.record(`attribute:${name}`);
    this.attributes.set(name, next);
    if (name === 'class') this.className = next;
    if (name === 'id') this.id = next;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = next;
    }
  }

  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }

  appendChild(node) {
    if (node == null) return node;
    node.parentNode = this;
    this.childNodes.push(node);
    this.record('appendChild');
    return node;
  }

  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node);
    }
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this);
    this.parentNode = null;
  }

  querySelector(selector) { return this.ownerDocument.querySelector(`${this.id ? `#${this.id} ` : ''}${selector}`); }
  querySelectorAll(selector) { return this.ownerDocument.querySelectorAll(`${this.id ? `#${this.id} ` : ''}${selector}`); }
  closest() { return this; }
  contains(node) { return node === this || this.childNodes.some(child => child.contains?.(node)); }

  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  select() { this.focus(); this.setSelectionRange(0, this.value.length); }

  setSelectionRange(start, end, direction = 'none') {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }

  showModal() { this.open = true; this.record('showModal'); }
  close() {
    if (!this.open) return;
    this.open = false;
    this.record('close');
    if (this.contains(this.ownerDocument.activeElement) || this.ownerDocument.activeElement !== this.ownerDocument.body) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
    this.dispatchEvent(new FakeEvent('close'));
  }

  reset() { this.record('reset'); }
  click() { this.onclick?.(new FakeEvent('click', { target: this })); }
  scrollIntoView() {}
  showPicker() {}
  getBoundingClientRect() { return { top: 0, left: 0, right: 200, bottom: 40, width: 200, height: 40 }; }
}

class FakeTextNode extends FakeNode {
  constructor(document, text) {
    super(document, '#text');
    this._textContent = String(text);
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.elements = new Map();
    this.selectorElements = new Map();
    this.mutations = [];
    this.recording = true;
    this.readyState = 'complete';
    this.visibilityState = 'visible';
    this.documentElement = new FakeNode(this, 'html', 'documentElement');
    this.body = new FakeNode(this, 'body', 'body');
    this.activeElement = this.body;
  }

  recordMutation(element, kind) {
    if (this.recording) this.mutations.push({ id: element.id, kind });
  }

  resetMutations() { this.mutations = []; }

  element(id, tagName = id.toLocaleLowerCase('en-US').includes('dialog') ? 'dialog' : 'div') {
    if (!this.elements.has(id)) this.elements.set(id, new FakeNode(this, tagName, id));
    return this.elements.get(id);
  }

  querySelector(selector) {
    const exactId = /^#([\w-]+)$/.exec(selector);
    if (exactId) return this.element(exactId[1]);
    if (selector === 'body') return this.body;
    if (selector === 'html') return this.documentElement;
    if (!this.selectorElements.has(selector)) this.selectorElements.set(selector, new FakeNode(this, 'div', `selector:${selector}`));
    return this.selectorElements.get(selector);
  }

  querySelectorAll() { return []; }
  createElement(tagName) { return new FakeNode(this, tagName); }
  createDocumentFragment() { return new FakeNode(this, '#fragment'); }
  createTextNode(text) { return new FakeTextNode(this, text); }
}

class FakeStorage {
  constructor(entries = {}) { this.entries = new Map(Object.entries(entries)); }
  get length() { return this.entries.size; }
  key(index) { return [...this.entries.keys()][index] ?? null; }
  getItem(key) { return this.entries.has(key) ? this.entries.get(key) : null; }
  setItem(key, value) { this.entries.set(String(key), String(value)); }
  removeItem(key) { this.entries.delete(String(key)); }
  clear() { this.entries.clear(); }
  dump() { return [...this.entries.values()].join('\n'); }
}

function initialState() {
  return {
    version: 11,
    onboarded: true,
    challengeStart: '2026-09-06',
    challengeDays: 0,
    challengeName: '',
    tasks: [],
    notes: [],
    folders: [],
    habits: [],
    checks: {},
    taskMemory: [],
    profile: { name: '' },
    appearance: { theme: 'aurora' },
    focusSessions: [],
    stats: { focusMs: 0, sessions: 0 },
    reminders: { enabled: false, time: '19:00', lastDate: '' },
    security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true },
    _savedAt: 1
  };
}

const appScript = new vm.Script(appSource, { filename: 'app.js' });
const notesScript = new vm.Script(notesSource, { filename: 'notes-pro.js' });

async function bootApplication() {
  const document = new FakeDocument();
  const localStorage = new FakeStorage({ 'sever-data-v2': JSON.stringify(initialState()) });
  const window = new FakeEventTarget();
  const timerIds = { value: 0 };
  const crypto = {
    randomUUID,
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    subtle: webcrypto.subtle
  };
  const noopTimer = () => ++timerIds.value;
  const context = {
    window,
    document,
    localStorage,
    navigator: { onLine: true },
    location: { href: 'https://example.test/', reload() {} },
    crypto,
    CustomEvent: class extends FakeEvent {},
    Event: FakeEvent,
    Blob,
    URL,
    console: { log() {}, warn() {}, error() {} },
    performance,
    structuredClone,
    queueMicrotask,
    requestAnimationFrame: callback => { callback(0); return 1; },
    cancelAnimationFrame() {},
    setTimeout: noopTimer,
    clearTimeout() {},
    setInterval: noopTimer,
    clearInterval() {},
    scrollTo() {},
    confirm: () => true,
    matchMedia: query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })
  };
  Object.assign(window, {
    window,
    document,
    localStorage,
    navigator: context.navigator,
    location: context.location,
    crypto,
    matchMedia: context.matchMedia,
    requestAnimationFrame: context.requestAnimationFrame,
    setTimeout: context.setTimeout,
    clearTimeout: context.clearTimeout,
    setInterval: context.setInterval,
    clearInterval: context.clearInterval,
    getSelection: () => ({ type: 'None', removeAllRanges() {} }),
    SeverSecurityCore: {
      persistentState: value => clone(value),
      assertProtectedNote() { return true; },
      shouldAutoLock() { return false; },
      createBackup: value => clone(value),
      createVaultExport: value => clone(value),
      MAX_BACKUP_BYTES: 5_000_000
    },
    SeverProtectedNotesCrypto: {
      protect: async () => { throw new Error('Crypto is not exercised by this draft test'); },
      unlock: async () => { throw new Error('Crypto is not exercised by this draft test'); },
      sealWithMaterial: async () => { throw new Error('Crypto is not exercised by this draft test'); }
    }
  });
  vm.createContext(context);
  appScript.runInContext(context);
  notesScript.runInContext(context);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  document.resetMutations();
  return {
    context,
    document,
    localStorage,
    window,
    element: id => document.element(id),
    run: expression => vm.runInContext(expression, context),
    state: () => window.SeverApp.getState()
  };
}

const rowCollectionsStart = cloudSource.indexOf('function rowCollections');
const cloudClassStart = cloudSource.indexOf('class SeverCloud');
const cloudClassEnd = cloudSource.indexOf('\nfunction counts', cloudClassStart);
assert.ok(rowCollectionsStart >= 0 && cloudClassStart > rowCollectionsStart && cloudClassEnd > cloudClassStart, 'Unable to isolate SeverCloud for the behavior harness');
const cloudHarnessSource = `
  const { rowsToState, mergeStates, collectionsFor, changedCollections, changedRecordIds } = globalThis.__deps;
  ${cloudSource.slice(rowCollectionsStart, cloudClassStart)}
  ${cloudSource.slice(cloudClassStart, cloudClassEnd)}
  globalThis.__SeverCloud = SeverCloud;
`;
const cloudScript = new vm.Script(cloudHarnessSource, { filename: 'cloud-runtime.behavior-harness.js' });

async function pullCloudState(application, makeRemote = local => clone(local)) {
  const statuses = [];
  const cloudContext = {
    navigator: { onLine: true },
    clearTimeout() {},
    queueMicrotask,
    __deps: {
      rowsToState: local => makeRemote(local),
      mergeStates: (_local, remote) => clone(remote),
      collectionsFor: () => ({
        tasks: new Map(), habits: new Map(), habitEntries: new Map(), notes: new Map(),
        folders: new Map(), focusSessions: new Map(), settings: new Map()
      }),
      changedCollections: detectChangedCollections,
      changedRecordIds: detectChangedRecordIds
    }
  };
  vm.createContext(cloudContext);
  cloudScript.runInContext(cloudContext);
  const cloud = new cloudContext.__SeverCloud(application.window.SeverApp);
  cloud.user = { id: 'regression-user' };
  cloud.hydrated = true;
  cloud.localOnly = false;
  cloud.running = false;
  cloud.fetchAll = async () => ({});
  cloud.setStatus = status => statuses.push(status);
  cloud.capture = () => { cloud.baseline = cloudContext.__deps.collectionsFor(application.window.SeverApp.getState()); };
  Object.defineProperty(cloud, 'queued', { configurable: true, get: () => [] });
  await cloud.pull();
  assert.deepEqual(statuses, ['synced'], 'The cloud pull failed inside the test harness');
}

const renderSurfaceIds = [
  'todayTasks', 'calendar', 'heatmap', 'habitList', 'noteList',
  'taskSuggestions', 'desktopCalendar', 'desktopHabitSummary'
];

function renderSurfaceMutations(document) {
  return document.mutations.filter(mutation => renderSurfaceIds.includes(mutation.id));
}

function snapshotDraft(application, dialogId, fieldId, extraFieldIds = []) {
  const dialog = application.element(dialogId);
  const field = application.element(fieldId);
  const trackedIds = [fieldId, ...extraFieldIds];
  return {
    open: dialog.open,
    fields: Object.fromEntries(trackedIds.map(id => {
      const tracked = application.element(id);
      return [id, { value: tracked.value, checked: tracked.checked }];
    })),
    focused: application.document.activeElement === field,
    selectionStart: field.selectionStart,
    selectionEnd: field.selectionEnd,
    selectionDirection: field.selectionDirection
  };
}

async function assertDraftSurvivesCloudPull({ open, dialogId, fieldId, marker, extraFields = {}, sameDomainUpdate }) {
  const application = await bootApplication();
  open(application);
  const dialog = application.element(dialogId);
  const field = application.element(fieldId);
  field.value = marker;
  for (const [id, draft] of Object.entries(extraFields)) {
    const extra = application.element(id);
    if (draft && typeof draft === 'object') {
      if ('value' in draft) extra.value = draft.value;
      if ('checked' in draft) extra.checked = draft.checked;
    } else extra.value = draft;
  }
  field.focus();
  field.setSelectionRange(3, marker.length - 2, 'forward');
  assert.equal(dialog.open, true, `${dialogId} did not open before the cloud test`);
  const extraFieldIds = Object.keys(extraFields);
  const expected = snapshotDraft(application, dialogId, fieldId, extraFieldIds);

  application.document.resetMutations();
  await pullCloudState(application);
  assert.deepEqual(
    snapshotDraft(application, dialogId, fieldId, extraFieldIds),
    expected,
    `${fieldId} lost its draft/focus/cursor during a no-op cloud pull`
  );

  application.document.resetMutations();
  await pullCloudState(application, local => {
    const remote = clone(local);
    remote.profile = { ...(remote.profile || {}), name: 'Remote profile update' };
    remote._savedAt = Number(remote._savedAt || 0) + 1000;
    return remote;
  });
  assert.deepEqual(
    snapshotDraft(application, dialogId, fieldId, extraFieldIds),
    expected,
    `${fieldId} lost its draft/focus/cursor during an unrelated cloud update`
  );
  assert.equal(application.state().profile.name, 'Remote profile update', 'The unrelated remote change was not applied');

  if (sameDomainUpdate) {
    application.document.resetMutations();
    await pullCloudState(application, local => {
      const remote = clone(local);
      remote[sameDomainUpdate.key].push(clone(sameDomainUpdate.record));
      remote._savedAt = Number(remote._savedAt || 0) + 1000;
      return remote;
    });
    assert.ok(application.state()[sameDomainUpdate.key].some(item => item.id === sameDomainUpdate.record.id), 'The same-domain remote record was not applied');
    assert.deepEqual(
      snapshotDraft(application, dialogId, fieldId, extraFieldIds),
      expected,
      `${fieldId} lost its draft/focus/cursor during a same-domain cloud update`
    );
  }
}

test('critical editor controls exist in the production markup', () => {
  for (const id of [
    'noteDialog', 'noteForm', 'noteTitle', 'noteBody',
    'taskDialog', 'taskForm', 'taskTitle',
    'habitDialog', 'habitForm', 'habitTitle',
    'quickAddDialog', 'quickCaptureForm', 'quickCaptureInput'
  ]) {
    assert.match(htmlSource, new RegExp(`id=["']${id}["']`), `Missing #${id}`);
  }
});

test('draft reconciliation contract is loaded before app code and remains memory-only', () => {
  assert.ok(uiStateSource, 'Missing js/ui-state.js draft reconciliation layer');
  assert.ok(htmlSource.indexOf('js/ui-state.js') < htmlSource.indexOf('app.js'), 'ui-state.js must load before app.js');
  assert.match(uiStateSource, /input, textarea, select, \[contenteditable="true"\]/);
  assert.doesNotMatch(uiStateSource, /localStorage|sessionStorage|indexedDB/, 'Draft snapshots must never be persisted');
  assert.match(appSource, /if\(!collections\.length\)return\{changed:false,collections:\[\]\}/, 'replaceState needs an early semantic no-op guard');
  assert.match(appSource, /SeverUiState\?\.capture\(\)[\s\S]{0,350}SeverUiState\?\.restore\(snapshot\)/, 'Changed-domain rendering must preserve active UI state');
  assert.match(cloudSource, /changedCollections\(local, merged\)[\s\S]{0,240}replaceState\(merged/, 'Cloud pull must classify changes before replaceState');
});

test('a semantic no-op cloud pull causes zero planner render mutations and no security lock', async () => {
  const application = await bootApplication();
  let cloudLocks = 0;
  application.window.addEventListener('sever:lock-protected-notes', event => {
    if (event.detail?.reason === 'cloud-replace') cloudLocks += 1;
  });
  application.document.resetMutations();

  await pullCloudState(application);

  const mutations = renderSurfaceMutations(application.document);
  const surfaces = [...new Set(mutations.map(mutation => mutation.id))].join(', ');
  assert.equal(mutations.length, 0, `No-op sync made ${mutations.length} render mutations across: ${surfaces}`);
  assert.equal(cloudLocks, 0, 'No-op sync emitted a protected-note lock event');
});

test('a semantic no-op cloud pull never emits a protected-note security lock', async () => {
  const application = await bootApplication();
  let cloudLocks = 0;
  application.window.addEventListener('sever:lock-protected-notes', event => {
    if (event.detail?.reason === 'cloud-replace') cloudLocks += 1;
  });

  await pullCloudState(application);

  assert.equal(cloudLocks, 0, 'No-op sync emitted a cloud-replace security lock');
});

test('Note draft keeps value, focus, selection and open dialog across cloud reconciliation', async () => {
  await assertDraftSurvivesCloudPull({
    open: application => application.window.SeverNotes.openNote(),
    dialogId: 'noteDialog',
    fieldId: 'noteTitle',
    marker: 'Черновик заметки до синхронизации',
    extraFields: {
      noteBody: 'Несохранённый текст заметки',
      noteFolder: 'folder-local-draft',
      noteProtected: { checked: false }
    },
    sameDomainUpdate: {
      key: 'notes',
      record: { id: 'remote-note', folderId: '', title: 'Удалённая заметка', body: '', kind: 'text', items: [], protected: false, updatedAt: Date.now() }
    }
  });
});

test('Note body keeps its own focus and cursor range across cloud reconciliation', async () => {
  await assertDraftSurvivesCloudPull({
    open: application => application.window.SeverNotes.openNote(),
    dialogId: 'noteDialog',
    fieldId: 'noteBody',
    marker: 'Длинный несохранённый текст заметки с курсором внутри',
    extraFields: {
      noteTitle: 'Заголовок остаётся на месте',
      noteFolder: 'folder-local-draft',
      noteProtected: { checked: false }
    },
    sameDomainUpdate: {
      key: 'notes',
      record: { id: 'remote-note-body', folderId: '', title: 'Другая заметка', body: '', kind: 'text', items: [], protected: false, updatedAt: Date.now() }
    }
  });
});

test('Task draft keeps value, focus, selection and open dialog across cloud reconciliation', async () => {
  await assertDraftSurvivesCloudPull({
    open: application => application.run('openTask()'),
    dialogId: 'taskDialog',
    fieldId: 'taskTitle',
    marker: 'Черновик задачи до синхронизации',
    extraFields: {
      taskDate: '2026-09-12',
      taskDuration: '47',
      taskCategory: 'Работа',
      taskPriority: { checked: true }
    },
    sameDomainUpdate: {
      key: 'tasks',
      record: { id: 'remote-task', title: 'Удалённая задача', date: '2026-09-06', category: 'Личное', completed: false, updatedAt: Date.now() }
    }
  });
});

test('Habit draft keeps value, focus, selection and open dialog across cloud reconciliation', async () => {
  await assertDraftSurvivesCloudPull({
    open: application => application.element('openHabit').onclick(),
    dialogId: 'habitDialog',
    fieldId: 'habitTitle',
    marker: 'Черновик привычки до синхронизации',
    sameDomainUpdate: {
      key: 'habits',
      record: { id: 'remote-habit', title: 'Удалённая привычка', updatedAt: Date.now() }
    }
  });
});

test('Quick Add draft keeps value, focus, selection and open dialog across cloud reconciliation', async () => {
  await assertDraftSurvivesCloudPull({
    open: application => application.element('globalAddBtn').onclick(),
    dialogId: 'quickAddDialog',
    fieldId: 'quickCaptureInput',
    marker: 'Быстрая задача до синхронизации',
    extraFields: {
      quickCaptureDate: '2026-09-13'
    },
    sameDomainUpdate: {
      key: 'tasks',
      record: { id: 'remote-quick-task', title: 'Другая удалённая задача', date: '2026-09-07', category: 'Работа', completed: false, updatedAt: Date.now() }
    }
  });
});

test('an unsaved protected Note draft never enters localStorage during cloud reconciliation', async () => {
  const application = await bootApplication();
  application.window.SeverNotes.openNote();
  const title = 'SEVER_PRIVATE_DRAFT_TITLE_92F1';
  const body = 'SEVER_PRIVATE_DRAFT_BODY_92F1';
  const password = 'SEVER_PRIVATE_DRAFT_PASSWORD_92F1';
  application.element('noteTitle').value = title;
  application.element('noteBody').value = body;
  application.element('noteProtected').checked = true;
  application.element('notePassword').value = password;

  await pullCloudState(application);

  const persisted = application.localStorage.dump();
  assert.doesNotMatch(persisted, /SEVER_PRIVATE_DRAFT_(?:TITLE|BODY|PASSWORD)_92F1/);
});
