import type { Db } from '../db.ts';
import { AccountRepo } from './accounts.ts';
import { ActionRepo } from './actions.ts';
import { ActivityRepo } from './activity.ts';
import { AiRunRepo } from './ai-runs.ts';
import { CaptureRepo } from './captures.ts';
import { RateLimitRepo } from './limits.ts';
import { EventRepo, InboxRepo, NoteRepo, TaskRepo } from './records.ts';
import { Housekeeping, InboundQueue } from './system.ts';

/** User-scoped repositories: every method requires an AccountContext. */
export function createRepositories(db: Db) {
  return {
    accounts: new AccountRepo(db),
    tasks: new TaskRepo(db),
    events: new EventRepo(db),
    notes: new NoteRepo(db),
    inbox: new InboxRepo(db),
    captures: new CaptureRepo(db),
    actions: new ActionRepo(db),
    activity: new ActivityRepo(db),
    rateLimits: new RateLimitRepo(db),
    aiRuns: new AiRunRepo(db),
  };
}

/** Service-level repositories for server entrypoints and scheduled jobs. */
export function createSystemRepositories(db: Db) {
  return { inbound: new InboundQueue(db), housekeeping: new Housekeeping(db) };
}

export type Repositories = ReturnType<typeof createRepositories>;
