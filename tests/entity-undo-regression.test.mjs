import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  collectionsFor,
  diffCollections,
  mergeStates,
  prepareState
} from '../js/sync-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const notesSource = fs.readFileSync(path.join(root, 'notes-pro.js'), 'utf8');

const TODAY = '2026-09-06';
const CREATED_AT = Date.parse('2026-09-06T08:00:00.000Z');
const DELETED_AT = Date.parse('2026-09-06T09:00:00.000Z');
const RESTORED_AT = Date.parse('2026-09-06T10:00:00.000Z');

const clone = value => JSON.parse(JSON.stringify(value));

function plannerState(overrides = {}) {
  const supplied = clone(overrides);
  const state = {
    version: 12,
    onboarded: true,
    tasks: [],
    notes: [],
    folders: [],
    habits: [],
    checks: {},
    focusSessions: [],
    taskMemory: [],
    profile: {},
    appearance: {},
    stats: {},
    reminders: {},
    security: {},
    _savedAt: CREATED_AT,
    ...supplied
  };
  state.syncMeta = {
    seededAt: CREATED_AT,
    settingsUpdatedAt: CREATED_AT,
    habitEntryUpdatedAt: {},
    tombstones: {},
    ...(supplied.syncMeta || {})
  };
  state.syncMeta.habitEntryUpdatedAt = {
    ...(supplied.syncMeta?.habitEntryUpdatedAt || {})
  };
  state.syncMeta.tombstones = {
    ...(supplied.syncMeta?.tombstones || {})
  };
  return state;
}

// Extracts and evaluates the actual production declarations. Only browser-facing
// save/render/toast boundaries are replaced, so Undo mutation logic is not copied.
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `app.js must declare function ${name}()`);
  const bodyStart = source.indexOf('{', start);
  assert.notEqual(bodyStart, -1, `function ${name}() must have a body`);

  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error(`Could not extract complete function ${name}()`);
}

const appUndoRuntime = [
  'clearSyncTombstone',
  'restoreDeletedRecord',
  'performUndo',
  'setHabitCompletion'
].map(name => extractFunction(appSource, name)).join('\n');

function undoHarness(initialState, now = RESTORED_AT) {
  const calls = { save: 0, render: 0, toasts: [] };
  class FixedDate extends Date {
    constructor(...values) { super(...(values.length ? values : [now])); }
    static now() { return now; }
  }

  const context = vm.createContext({
    state: initialState,
    TODAY,
    Date: FixedDate,
    cloneValue: clone,
    save: () => { calls.save += 1; },
    saveAndRender: () => { calls.save += 1; calls.render += 1; },
    window: { SeverNotes: { render: () => { calls.render += 1; } } },
    renderHabits: () => { calls.render += 1; },
    renderProgress: () => { calls.render += 1; },
    refreshDesktopContext: () => { calls.render += 1; },
    toast: message => { calls.toasts.push(message); }
  });
  vm.runInContext(appUndoRuntime, context, { filename: 'app.js#entity-undo-harness' });

  return {
    calls,
    get state() { return context.state; },
    undo(action) {
      context.__undoAction = clone(action);
      vm.runInContext('performUndo(__undoAction)', context);
      delete context.__undoAction;
    }
  };
}

function deleteIntoTombstone(state, mutate) {
  const activeCollections = collectionsFor(state);
  mutate(state);
  const deletedCollections = prepareState(state, activeCollections, DELETED_AT);
  return {
    deletedCollections,
    remoteDeletedState: clone(state)
  };
}

function assertActiveUpsert(deletedCollections, restoredState, collection, id) {
  const restoredCollections = prepareState(restoredState, deletedCollections, RESTORED_AT + 1);
  const operation = diffCollections(deletedCollections, restoredCollections, RESTORED_AT + 2)
    .find(candidate => candidate.collection === collection && candidate.id === id);
  assert.ok(operation, `${collection}:${id} must produce a cloud operation after Undo`);
  assert.equal(operation.type, 'upsert');
  assert.equal(operation.record.deletedAt, undefined, `${collection}:${id} must be active`);
  return restoredCollections;
}

test('production handlers are wired to typed entity Undo actions', () => {
  assert.match(appSource, /toast\('Задача удалена',\s*\{\s*type:\s*'task-delete'/);
  assert.match(appSource, /toast\('Привычка удалена',\s*\{\s*type:\s*'habit-delete'/);
  assert.match(appSource, /type:\s*'habit-entry'\s*,\s*habitId\s*,\s*date/);
  assert.match(notesSource, /toast\('Заметка удалена',\s*\{\s*type:\s*'note-delete'/);
  assert.match(notesSource, /type:\s*'folder-delete'\s*,\s*folder:/);
});

test('Task Undo revives the same record after its tombstone and survives pull merge', () => {
  const task = {
    id: 'task-undo',
    title: 'Проверить отчёт',
    date: TODAY,
    duration: 30,
    category: 'Работа',
    priority: true,
    challenge: false,
    completed: false,
    completedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  };
  const state = plannerState({ tasks: [task] });
  const snapshot = clone(task);
  const { deletedCollections, remoteDeletedState } = deleteIntoTombstone(state, current => {
    current.tasks.splice(0, 1);
  });
  assert.ok(deletedCollections.tasks.get(task.id)?.deletedAt);

  const harness = undoHarness(state);
  harness.undo({ type: 'task-delete', task: snapshot, index: 0 });

  assert.equal(harness.state.tasks.length, 1);
  assert.equal(harness.state.tasks[0].id, task.id);
  assert.equal(harness.state.tasks[0].title, task.title);
  assert.ok(harness.state.tasks[0].updatedAt >= RESTORED_AT);
  assert.equal(harness.state.syncMeta.tombstones[`tasks:${task.id}`], undefined);
  assertActiveUpsert(deletedCollections, harness.state, 'tasks', task.id);

  const afterPull = mergeStates(harness.state, remoteDeletedState);
  assert.equal(afterPull.tasks.find(item => item.id === task.id)?.title, task.title);
});

test('Note Undo revives content after its tombstone and survives pull merge', () => {
  const note = {
    id: 'note-undo',
    folderId: '',
    title: 'Идея',
    body: 'Сохранённый текст',
    kind: 'text',
    items: [],
    done: false,
    protected: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  };
  const state = plannerState({ notes: [note] });
  const snapshot = clone(note);
  const { deletedCollections, remoteDeletedState } = deleteIntoTombstone(state, current => {
    current.notes.splice(0, 1);
  });
  assert.ok(deletedCollections.notes.get(note.id)?.deletedAt);

  const harness = undoHarness(state);
  harness.undo({ type: 'note-delete', note: snapshot, index: 0 });

  const restored = harness.state.notes.find(item => item.id === note.id);
  assert.equal(restored?.body, note.body);
  assert.ok(restored.updatedAt >= RESTORED_AT);
  assert.equal(harness.state.syncMeta.tombstones[`notes:${note.id}`], undefined);
  assertActiveUpsert(deletedCollections, harness.state, 'notes', note.id);

  const afterPull = mergeStates(harness.state, remoteDeletedState);
  assert.equal(afterPull.notes.find(item => item.id === note.id)?.body, note.body);
});

test('Folder Undo revives the folder and its deleted Note after both tombstones', () => {
  const folder = {
    id: 'folder-undo',
    name: 'Работа',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  };
  const note = {
    id: 'folder-note-undo',
    folderId: folder.id,
    title: 'План',
    body: 'Шаги проекта',
    kind: 'text',
    items: [],
    done: false,
    protected: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  };
  const state = plannerState({ folders: [folder], notes: [note] });
  const folderSnapshot = clone(folder);
  const noteSnapshot = clone(note);
  const { deletedCollections, remoteDeletedState } = deleteIntoTombstone(state, current => {
    current.folders.splice(0, 1);
    current.notes.splice(0, 1);
  });
  assert.ok(deletedCollections.folders.get(folder.id)?.deletedAt);
  assert.ok(deletedCollections.notes.get(note.id)?.deletedAt);

  const harness = undoHarness(state);
  harness.undo({
    type: 'folder-delete',
    folder: folderSnapshot,
    index: 0,
    notes: [noteSnapshot]
  });

  assert.equal(harness.state.folders.find(item => item.id === folder.id)?.name, folder.name);
  assert.equal(harness.state.notes.find(item => item.id === note.id)?.folderId, folder.id);
  assert.equal(harness.state.syncMeta.tombstones[`folders:${folder.id}`], undefined);
  assert.equal(harness.state.syncMeta.tombstones[`notes:${note.id}`], undefined);
  assertActiveUpsert(deletedCollections, harness.state, 'folders', folder.id);
  assertActiveUpsert(deletedCollections, harness.state, 'notes', note.id);

  const afterPull = mergeStates(harness.state, remoteDeletedState);
  assert.equal(afterPull.folders.find(item => item.id === folder.id)?.name, folder.name);
  assert.equal(afterPull.notes.find(item => item.id === note.id)?.folderId, folder.id);
});

test('Habit Undo revives its parent and every dated entry after tombstones', () => {
  const habit = {
    id: 'habit-undo',
    title: 'Читать',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  };
  const dates = ['2026-09-04', '2026-09-05'];
  const state = plannerState({
    habits: [habit],
    checks: { [habit.id]: dates },
    syncMeta: {
      habitEntryUpdatedAt: Object.fromEntries(dates.map(date => [`${habit.id}:${date}`, CREATED_AT]))
    }
  });
  const snapshot = clone(habit);
  const { deletedCollections, remoteDeletedState } = deleteIntoTombstone(state, current => {
    current.habits.splice(0, 1);
    delete current.checks[habit.id];
  });
  assert.ok(deletedCollections.habits.get(habit.id)?.deletedAt);
  dates.forEach(date => assert.ok(deletedCollections.habitEntries.get(`${habit.id}:${date}`)?.deletedAt));

  const harness = undoHarness(state);
  harness.undo({ type: 'habit-delete', habit: snapshot, index: 0, dates });

  assert.equal(harness.state.habits.find(item => item.id === habit.id)?.title, habit.title);
  assert.deepEqual([...harness.state.checks[habit.id]], dates);
  assert.equal(harness.state.syncMeta.tombstones[`habits:${habit.id}`], undefined);
  assertActiveUpsert(deletedCollections, harness.state, 'habits', habit.id);
  dates.forEach(date => {
    const entryId = `${habit.id}:${date}`;
    assert.equal(harness.state.syncMeta.tombstones[`habitEntries:${entryId}`], undefined);
    assert.ok(harness.state.syncMeta.habitEntryUpdatedAt[entryId] >= RESTORED_AT);
    assertActiveUpsert(deletedCollections, harness.state, 'habitEntries', entryId);
  });

  const afterPull = mergeStates(harness.state, remoteDeletedState);
  assert.equal(afterPull.habits.find(item => item.id === habit.id)?.title, habit.title);
  assert.deepEqual(afterPull.checks[habit.id], dates);
});

test('Habit date Undo clears that exact entry tombstone and does not overwrite other dates', () => {
  const habit = {
    id: 'habit-date-undo',
    title: 'Тренировка',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT
  };
  const restoredDate = '2026-09-05';
  const untouchedDate = '2026-09-04';
  const restoredEntryId = `${habit.id}:${restoredDate}`;
  const state = plannerState({
    habits: [habit],
    checks: { [habit.id]: [untouchedDate, restoredDate] },
    syncMeta: {
      habitEntryUpdatedAt: {
        [`${habit.id}:${untouchedDate}`]: CREATED_AT,
        [restoredEntryId]: CREATED_AT
      }
    }
  });
  const { deletedCollections, remoteDeletedState } = deleteIntoTombstone(state, current => {
    current.checks[habit.id] = [untouchedDate];
  });
  assert.ok(deletedCollections.habitEntries.get(restoredEntryId)?.deletedAt);

  const harness = undoHarness(state);
  harness.undo({
    type: 'habit-entry',
    habitId: habit.id,
    date: restoredDate,
    completed: true,
    expected: false
  });

  assert.deepEqual([...harness.state.checks[habit.id]], [untouchedDate, restoredDate]);
  assert.equal(harness.state.syncMeta.tombstones[`habitEntries:${restoredEntryId}`], undefined);
  assert.ok(harness.state.syncMeta.habitEntryUpdatedAt[restoredEntryId] >= RESTORED_AT);
  assertActiveUpsert(deletedCollections, harness.state, 'habitEntries', restoredEntryId);

  const afterPull = mergeStates(harness.state, remoteDeletedState);
  assert.deepEqual(afterPull.checks[habit.id], [untouchedDate, restoredDate]);
});
