import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionsFor, rowsToState } from '../js/sync-core.mjs';

const base = () => ({
  version: 11,
  tasks: [], habits: [], checks: {}, notes: [], folders: [], focusSessions: [], taskMemory: [],
  stats: { focusMs: 0, sessions: 0 }, reminders: {}, profile: {}, appearance: { theme: 'light' }, security: {}
});

test('note organization metadata is projected through existing private user settings', () => {
  const state = base();
  state.profile.noteOrganization = {
    v: 1,
    notes: {
      note1: { pinned: true, tags: ['Учёба', 'SEVER'] }
    }
  };
  const settings = collectionsFor(state).settings.get('settings').data;
  assert.deepEqual(settings.profile.noteOrganization, state.profile.noteOrganization);
});

test('note organization metadata restores on a second device without changing the notes table contract', () => {
  const restored = rowsToState(base(), {
    notes: [{
      id: 'note1', folder_id: null, title: 'Python', body: '', kind: 'text', items: [], done: false,
      protected: false, secure: null, created_at: '2026-09-11T06:00:00Z', updated_at: '2026-09-11T06:00:00Z'
    }],
    settings: [{
      data: {
        profile: {
          name: 'User',
          noteOrganization: { v: 1, notes: { note1: { pinned: true, tags: ['Учёба'] } } }
        }
      },
      updated_at: '2026-09-11T06:01:00Z'
    }]
  });
  assert.equal(restored.notes[0].title, 'Python');
  assert.deepEqual(restored.profile.noteOrganization.notes.note1, { pinned: true, tags: ['Учёба'] });
  assert.equal(Object.hasOwn(restored.notes[0], 'pinned'), false);
  assert.equal(Object.hasOwn(restored.notes[0], 'tags'), false);
});
