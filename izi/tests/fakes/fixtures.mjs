import { createRepositories, createSystemRepositories } from '../../src/core/repo/index.ts';
import { trustVerifiedIdentity } from '../../src/core/identity/trusted.ts';
import { freshDb } from './db.mjs';

let nextTelegramId = 100000;

/** Migrated database, repositories and helpers to create accounts. */
export async function setup() {
  const { pg, db } = await freshDb();
  const repos = createRepositories(db);
  const system = createSystemRepositories(db);
  const account = async ({ timezone = 'Europe/Moscow' } = {}) => {
    const identity = trustVerifiedIdentity('telegram', nextTelegramId++, 'test');
    const { context } = await repos.accounts.resolveOrCreate(identity);
    if (timezone) await repos.accounts.setTimezone(context, timezone, 'user');
    return context;
  };
  return { pg, db, repos, system, account };
}

/** Proposes and confirms operations in one go; returns the apply result. */
export async function applyOps(repos, context, operations, extra = {}) {
  const action = await repos.actions.propose(context, { kind: 'mutation', channel: 'telegram', operations, ...extra });
  const result = await repos.actions.confirm(context, action.id);
  return { action, result };
}

export const createTask = async (repos, context, data) => {
  const { result } = await applyOps(repos, context, [{ op: 'create', entity: 'task', data }]);
  return repos.tasks.get(context, result.operations[0].id);
};
