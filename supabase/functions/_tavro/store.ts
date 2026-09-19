// Typed data services for TAVRO.
//
// This is the only module that writes TAVRO rows. Every method takes an
// account id that the caller has already proved (Telegram signature or verified
// webhook), and every query filters on it. No caller — and certainly no language
// model — ever supplies SQL or an account id of its own choosing.

import { checked, day, fail, integer, oneOf, text, uuid } from '../_shared/validation.ts';
import { addDays, clockIn, todayIn, zonedToUtc } from '../_shared/datetime.ts';
import { entitlementOf, type Entitlement, type Subscription } from './billing.ts';
import type { CaptureItem } from './ai/schema.ts';

export type Account = {
  id: string;
  telegram_id: number;
  first_name: string;
  username: string | null;
  timezone: string;
  timezone_source: string;
  reminders_enabled: boolean;
  onboarded_at: string | null;
  created_at: string;
};

export type SavedRecord = { kind: 'task' | 'event' | 'note' | 'diary' | 'meal' | 'habit'; id: string; title: string; date: string | null; time: string | null };

/** Reminder offsets, in minutes before the moment itself. */
export const REMINDER_OFFSETS = { event: 30, task: 15 } as const;
/** Local hour used for all-day reminders and the day-before nudge. */
export const MORNING_HOUR = '09:00';
export const EVENING_HOUR = '20:00';

export class TavroStore {
  db: any;
  constructor(db: any) { this.db = db; }

  // ------------------------------------------------------------- accounts ---

  /** Finds or creates the account for a Telegram user verified upstream. */
  async account(user: { id: number; first_name?: string; username?: string; language_code?: string }, timezoneHint?: string): Promise<Account> {
    const telegramId = user.id;
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) fail('AUTH_INVALID', 'Некорректный Telegram ID.', 401);

    const existing = checked(await this.db.from('tavro_accounts').select('*').eq('telegram_id', telegramId).maybeSingle()) as Account | null;
    if (existing) {
      const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
      const firstName = (user.first_name || '').slice(0, 128);
      if (firstName && firstName !== existing.first_name) patch.first_name = firstName;
      const username = user.username ? user.username.slice(0, 64) : null;
      if (username !== existing.username) patch.username = username;
      // A client-reported timezone never overrides one the user set themselves.
      if (timezoneHint && existing.timezone_source !== 'user' && timezoneHint !== existing.timezone) {
        patch.timezone = timezoneHint;
        patch.timezone_source = 'client';
      }
      const updated = checked(await this.db.from('tavro_accounts').update(patch).eq('id', existing.id).select('*').single());
      return updated as Account;
    }

    const created = checked(await this.db.from('tavro_accounts').insert({
      telegram_id: telegramId,
      first_name: (user.first_name || '').slice(0, 128),
      username: user.username ? user.username.slice(0, 64) : null,
      language_code: user.language_code ? user.language_code.slice(0, 16) : null,
      ...(timezoneHint ? { timezone: timezoneHint, timezone_source: 'client' } : {}),
    }).select('*').single());
    return created as Account;
  }

  async setTimezone(accountId: string, timezone: string): Promise<void> {
    checked(await this.db.from('tavro_accounts')
      .update({ timezone, timezone_source: 'user', updated_at: new Date().toISOString() })
      .eq('id', uuid(accountId)).select('id').single());
  }

  async markOnboarded(accountId: string): Promise<void> {
    await this.db.from('tavro_accounts').update({ onboarded_at: new Date().toISOString() }).eq('id', accountId).is('onboarded_at', null);
  }

  async setRemindersEnabled(accountId: string, enabled: boolean): Promise<void> {
    checked(await this.db.from('tavro_accounts').update({ reminders_enabled: enabled, updated_at: new Date().toISOString() }).eq('id', uuid(accountId)).select('id').single());
  }

  // --------------------------------------------------------- entitlements ---

  async entitlement(accountId: string, now = Date.now()): Promise<Entitlement> {
    const row = checked(await this.db.from('tavro_subscriptions').select('*').eq('account_id', uuid(accountId)).maybeSingle()) as Subscription | null;
    return entitlementOf(row, now);
  }

  // -------------------------------------------------------------- capture ---

  async createCapture(accountId: string, input: { source: string; rawText?: string | null; transcript?: string | null; draft: unknown; chatId?: number | null; aiRequestId?: string | null }) {
    return checked(await this.db.from('tavro_captures').insert({
      account_id: accountId,
      source: oneOf(input.source, ['text', 'voice', 'photo', 'miniapp', 'quick'], 'источник'),
      raw_text: input.rawText ?? null,
      transcript: input.transcript ?? null,
      draft: input.draft,
      chat_id: input.chatId ?? null,
      ai_request_id: input.aiRequestId ?? null,
    }).select('*').single());
  }

  async captureById(accountId: string, captureId: string) {
    const row = checked(await this.db.from('tavro_captures').select('*').eq('id', uuid(captureId)).eq('account_id', accountId).maybeSingle());
    if (!row) fail('NOT_FOUND', 'Черновик не найден. Отправьте фразу заново.', 404);
    return row;
  }

  async attachCaptureMessage(captureId: string, messageId: number) {
    await this.db.from('tavro_captures').update({ message_id: messageId }).eq('id', captureId);
  }

  /**
   * Marks a pending capture as confirmed and returns false when it was already
   * handled. This is what stops a double tap on "Сохранить" from creating the
   * same four records twice.
   */
  async claimCapture(accountId: string, captureId: string): Promise<boolean> {
    const rows = checked(await this.db.from('tavro_captures')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', uuid(captureId)).eq('account_id', accountId).eq('status', 'pending')
      .select('id'));
    return Array.isArray(rows) && rows.length > 0;
  }

  async discardCapture(accountId: string, captureId: string): Promise<boolean> {
    const rows = checked(await this.db.from('tavro_captures')
      .update({ status: 'discarded', updated_at: new Date().toISOString() })
      .eq('id', uuid(captureId)).eq('account_id', accountId).eq('status', 'pending')
      .select('id'));
    return Array.isArray(rows) && rows.length > 0;
  }

  async recordCaptureResults(captureId: string, records: SavedRecord[]) {
    await this.db.from('tavro_captures').update({ created_record_ids: records, updated_at: new Date().toISOString() }).eq('id', captureId);
  }

  // ---------------------------------------------------------------- saving ---

  /** Persists a confirmed draft. Each item becomes exactly one record. */
  async saveItems(account: Account, items: CaptureItem[], options: { source: string; captureId?: string | null }): Promise<SavedRecord[]> {
    const source = oneOf(options.source, ['text', 'voice', 'photo', 'miniapp', 'quick', 'import'], 'источник');
    const captureId = options.captureId ?? null;
    const saved: SavedRecord[] = [];

    for (const item of items) {
      if (item.type === 'task') {
        const row = checked(await this.db.from('tavro_tasks').insert({
          account_id: account.id,
          title: item.title,
          details: item.details,
          scheduled_for: item.date,
          scheduled_time: item.time,
          duration_minutes: item.durationMinutes,
          ...(item.category ? { category: item.category } : {}),
          priority: item.priority,
          source, capture_id: captureId,
        }).select('id,title,scheduled_for,scheduled_time').single());
        saved.push({ kind: 'task', id: row.id, title: row.title, date: row.scheduled_for, time: row.scheduled_time });
        await this.scheduleTaskReminders(account, row.id, row.scheduled_for, row.scheduled_time);
        continue;
      }

      if (item.type === 'event') {
        // An event without a date cannot be scheduled; it is kept as a task so
        // the user does not silently lose it.
        if (!item.date) {
          const row = checked(await this.db.from('tavro_tasks').insert({
            account_id: account.id, title: item.title, details: item.details, scheduled_time: item.time,
            category: 'Встречи', source, capture_id: captureId,
          }).select('id,title,scheduled_for,scheduled_time').single());
          saved.push({ kind: 'task', id: row.id, title: row.title, date: null, time: row.scheduled_time });
          continue;
        }
        const duration = item.durationMinutes || 60;
        const startsAt = item.time ? zonedToUtc(item.date, item.time, account.timezone) : null;
        const row = checked(await this.db.from('tavro_events').insert({
          account_id: account.id,
          title: item.title,
          details: item.details,
          event_date: item.date,
          event_time: item.time,
          duration_minutes: duration,
          timezone: account.timezone,
          starts_at: startsAt,
          ends_at: startsAt ? new Date(Date.parse(startsAt) + duration * 60000).toISOString() : null,
          location: item.location,
          participants: item.participants,
          source, capture_id: captureId,
        }).select('id,title,event_date,event_time').single());
        saved.push({ kind: 'event', id: row.id, title: row.title, date: row.event_date, time: row.event_time });
        await this.scheduleEventReminders(account, row.id, row.event_date, row.event_time);
        continue;
      }

      if (item.type === 'habit') {
        const row = checked(await this.db.from('tavro_habits').insert({ account_id: account.id, title: item.title }).select('id,title').single());
        saved.push({ kind: 'habit', id: row.id, title: row.title, date: null, time: null });
        continue;
      }

      const today = todayIn(account.timezone);
      const row = checked(await this.db.from('tavro_notes').insert({
        account_id: account.id,
        kind: item.type,
        title: item.title,
        body: item.body || item.title,
        entry_date: item.date || (item.type === 'note' ? null : today),
        source, capture_id: captureId,
      }).select('id,title,kind,entry_date').single());
      saved.push({ kind: item.type, id: row.id, title: row.title, date: row.entry_date, time: null });
    }

    if (captureId) await this.recordCaptureResults(captureId, saved);
    return saved;
  }

  // ------------------------------------------------------------- reminders ---

  private async putReminder(accountId: string, targetKind: 'task' | 'event', targetId: string, kind: string, remindAt: string) {
    // Past moments are not scheduled: a reminder for a meeting that already
    // started is noise, not a service.
    if (Date.parse(remindAt) <= Date.now()) return;
    await this.db.from('tavro_reminders')
      .upsert({ account_id: accountId, target_kind: targetKind, target_id: targetId, kind, remind_at: remindAt, status: 'scheduled' },
        { onConflict: 'target_kind,target_id,kind,remind_at', ignoreDuplicates: true });
  }

  async scheduleTaskReminders(account: Account, taskId: string, date: string | null, time: string | null) {
    if (!account.reminders_enabled || !date) return;
    if (time) {
      const at = Date.parse(zonedToUtc(date, time, account.timezone)) - REMINDER_OFFSETS.task * 60000;
      await this.putReminder(account.id, 'task', taskId, 'before', new Date(at).toISOString());
    } else {
      await this.putReminder(account.id, 'task', taskId, 'morning', zonedToUtc(date, MORNING_HOUR, account.timezone));
    }
  }

  async scheduleEventReminders(account: Account, eventId: string, date: string | null, time: string | null) {
    if (!account.reminders_enabled || !date) return;
    if (time) {
      const at = Date.parse(zonedToUtc(date, time, account.timezone)) - REMINDER_OFFSETS.event * 60000;
      await this.putReminder(account.id, 'event', eventId, 'before', new Date(at).toISOString());
    } else {
      await this.putReminder(account.id, 'event', eventId, 'morning', zonedToUtc(date, MORNING_HOUR, account.timezone));
    }
    const todayLocal = todayIn(account.timezone);
    if (date > addDays(todayLocal, 1)) {
      await this.putReminder(account.id, 'event', eventId, 'day_before', zonedToUtc(addDays(date, -1), EVENING_HOUR, account.timezone));
    }
  }

  /** Completing or deleting a record must silence its pending reminders. */
  async cancelReminders(accountId: string, targetKind: 'task' | 'event', targetId: string) {
    await this.db.from('tavro_reminders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('account_id', accountId).eq('target_kind', targetKind).eq('target_id', targetId).eq('status', 'scheduled');
  }

  // ------------------------------------------------------------ task edits ---

  async completeTask(account: Account, taskId: string, completed = true) {
    const rows = checked(await this.db.from('tavro_tasks')
      .update({ completed, completed_at: completed ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', uuid(taskId)).eq('account_id', account.id).is('deleted_at', null)
      .select('id,title,completed,scheduled_for,scheduled_time'));
    if (!rows?.length) fail('NOT_FOUND', 'Задача не найдена.', 404);
    if (completed) await this.cancelReminders(account.id, 'task', taskId);
    else await this.scheduleTaskReminders(account, taskId, rows[0].scheduled_for, rows[0].scheduled_time);
    return rows[0];
  }

  async snoozeTask(account: Account, taskId: string, days: number) {
    const task = checked(await this.db.from('tavro_tasks').select('*').eq('id', uuid(taskId)).eq('account_id', account.id).is('deleted_at', null).maybeSingle());
    if (!task) fail('NOT_FOUND', 'Задача не найдена.', 404);
    const base = task.scheduled_for || todayIn(account.timezone);
    const next = addDays(base, integer(days, 1, 365));
    const rows = checked(await this.db.from('tavro_tasks')
      .update({ scheduled_for: next, updated_at: new Date().toISOString() })
      .eq('id', taskId).eq('account_id', account.id).select('id,title,scheduled_for,scheduled_time'));
    await this.cancelReminders(account.id, 'task', taskId);
    await this.scheduleTaskReminders(account, taskId, next, rows[0].scheduled_time);
    return rows[0];
  }

  async deleteTask(account: Account, taskId: string) {
    const rows = checked(await this.db.from('tavro_tasks')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', uuid(taskId)).eq('account_id', account.id).is('deleted_at', null).select('id,title'));
    if (!rows?.length) fail('NOT_FOUND', 'Задача не найдена.', 404);
    await this.cancelReminders(account.id, 'task', taskId);
    return rows[0];
  }

  async restoreTask(account: Account, taskId: string) {
    const rows = checked(await this.db.from('tavro_tasks')
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq('id', uuid(taskId)).eq('account_id', account.id).select('id,title,scheduled_for,scheduled_time'));
    if (!rows?.length) fail('NOT_FOUND', 'Задача не найдена.', 404);
    await this.scheduleTaskReminders(account, taskId, rows[0].scheduled_for, rows[0].scheduled_time);
    return rows[0];
  }

  async updateEventStatus(account: Account, eventId: string, status: 'planned' | 'done' | 'cancelled') {
    const rows = checked(await this.db.from('tavro_events')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', uuid(eventId)).eq('account_id', account.id).is('deleted_at', null).select('id,title'));
    if (!rows?.length) fail('NOT_FOUND', 'Встреча не найдена.', 404);
    if (status !== 'planned') await this.cancelReminders(account.id, 'event', eventId);
    return rows[0];
  }

  // ----------------------------------------------------------------- reads ---

  /** Everything happening on one local day, ordered the way the day happens. */
  async agenda(account: Account, date: string) {
    const target = day(date);
    const [tasks, events] = await Promise.all([
      this.db.from('tavro_tasks').select('id,title,details,scheduled_for,scheduled_time,duration_minutes,category,priority,completed')
        .eq('account_id', account.id).eq('scheduled_for', target).is('deleted_at', null).order('scheduled_time', { ascending: true, nullsFirst: false }).limit(100),
      this.db.from('tavro_events').select('id,title,details,event_date,event_time,duration_minutes,location,participants,status')
        .eq('account_id', account.id).eq('event_date', target).is('deleted_at', null).order('event_time', { ascending: true, nullsFirst: false }).limit(100),
    ]);
    return { date: target, tasks: checked(tasks) || [], events: checked(events) || [] };
  }

  /** Dated work that is still open and already in the past. */
  async overdue(account: Account, today: string, limit = 20) {
    return checked(await this.db.from('tavro_tasks')
      .select('id,title,scheduled_for,scheduled_time')
      .eq('account_id', account.id).eq('completed', false).is('deleted_at', null)
      .lt('scheduled_for', day(today)).order('scheduled_for', { ascending: false }).limit(limit)) || [];
  }

  /** Undated tasks — the inbox a voice capture naturally fills. */
  async inbox(account: Account, limit = 50) {
    return checked(await this.db.from('tavro_tasks')
      .select('id,title,scheduled_time,category,priority,created_at')
      .eq('account_id', account.id).eq('completed', false).is('deleted_at', null).is('scheduled_for', null)
      .order('created_at', { ascending: false }).limit(limit)) || [];
  }

  async notes(account: Account, kind: 'note' | 'diary' | 'meal', limit = 50) {
    return checked(await this.db.from('tavro_notes')
      .select('id,kind,title,body,entry_date,photo_file_id,photo_summary,photo_summary_is_estimate,created_at')
      .eq('account_id', account.id).eq('kind', kind).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(limit)) || [];
  }

  async habitsWithToday(account: Account, date: string) {
    const habits = checked(await this.db.from('tavro_habits').select('id,title,target_per_week')
      .eq('account_id', account.id).is('deleted_at', null).order('created_at', { ascending: true }).limit(100)) || [];
    const entries = checked(await this.db.from('tavro_habit_entries').select('habit_id,entry_date,completed')
      .eq('account_id', account.id).gte('entry_date', addDays(date, -27)).lte('entry_date', date).limit(1000)) || [];
    return { habits, entries };
  }

  async toggleHabit(account: Account, habitId: string, date: string) {
    const target = day(date);
    if (target > todayIn(account.timezone)) fail('VALIDATION', 'Нельзя отметить привычку в будущем.');
    const owned = checked(await this.db.from('tavro_habits').select('id').eq('id', uuid(habitId)).eq('account_id', account.id).is('deleted_at', null).maybeSingle());
    if (!owned) fail('NOT_FOUND', 'Привычка не найдена.', 404);
    const existing = checked(await this.db.from('tavro_habit_entries').select('id,completed').eq('habit_id', habitId).eq('entry_date', target).maybeSingle());
    if (existing) {
      const rows = checked(await this.db.from('tavro_habit_entries')
        .update({ completed: !existing.completed, updated_at: new Date().toISOString() })
        .eq('id', existing.id).eq('account_id', account.id).select('habit_id,entry_date,completed'));
      return rows[0];
    }
    return checked(await this.db.from('tavro_habit_entries')
      .insert({ account_id: account.id, habit_id: habitId, entry_date: target, completed: true })
      .select('habit_id,entry_date,completed').single());
  }

  /** Counts for the Progress screen, computed from records rather than stored. */
  async progress(account: Account, from: string, to: string) {
    const tasks = checked(await this.db.from('tavro_tasks').select('id,completed,scheduled_for,completed_at')
      .eq('account_id', account.id).is('deleted_at', null).gte('scheduled_for', day(from)).lte('scheduled_for', day(to)).limit(2000)) || [];
    const done = tasks.filter((task: any) => task.completed).length;
    return { from, to, total: tasks.length, completed: done, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
  }

  /** "What's next" for the Today screen and the bot's quick answer. */
  async upcoming(account: Account, limit = 5) {
    const today = todayIn(account.timezone);
    const now = clockIn(account.timezone);
    const horizon = addDays(today, 7);
    const [tasks, events] = await Promise.all([
      this.db.from('tavro_tasks').select('id,title,scheduled_for,scheduled_time')
        .eq('account_id', account.id).eq('completed', false).is('deleted_at', null)
        .gte('scheduled_for', today).lte('scheduled_for', horizon).order('scheduled_for').limit(limit * 3),
      this.db.from('tavro_events').select('id,title,event_date,event_time')
        .eq('account_id', account.id).eq('status', 'planned').is('deleted_at', null)
        .gte('event_date', today).lte('event_date', horizon).order('event_date').limit(limit * 3),
    ]);
    const merged = [
      ...(checked(tasks) || []).map((row: any) => ({ kind: 'task', id: row.id, title: row.title, date: row.scheduled_for, time: row.scheduled_time })),
      ...(checked(events) || []).map((row: any) => ({ kind: 'event', id: row.id, title: row.title, date: row.event_date, time: row.event_time })),
    ].filter(entry => entry.date > today || !entry.time || entry.time.slice(0, 5) >= now);
    merged.sort((a, b) => (a.date === b.date ? (a.time || '99:99').localeCompare(b.time || '99:99') : a.date.localeCompare(b.date)));
    return merged.slice(0, limit);
  }

  async addPhotoNote(account: Account, input: { kind: 'note' | 'meal'; fileId: string; caption: string | null; summary: string | null }) {
    return checked(await this.db.from('tavro_notes').insert({
      account_id: account.id,
      kind: input.kind,
      title: text(input.caption || (input.kind === 'meal' ? 'Фото еды' : 'Фото'), 200, { field: 'подпись' }),
      body: input.caption || '',
      entry_date: todayIn(account.timezone),
      photo_file_id: input.fileId,
      photo_summary: input.summary,
      photo_summary_is_estimate: true,
      source: 'photo',
    }).select('id,kind,title,entry_date').single());
  }
}
