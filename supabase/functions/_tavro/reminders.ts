// Server-side reminder dispatch.
//
// Reminders are claimed atomically (`tavro_claim_reminders` uses
// FOR UPDATE SKIP LOCKED), so two overlapping cron runs cannot send the same
// nudge twice. A reminder whose task was completed, deleted or cancelled in the
// meantime is skipped rather than sent.

import { checked } from '../_shared/validation.ts';
import { formatWhen, todayIn } from '../_shared/datetime.ts';
import { expireLapsed } from './payments.ts';
import { TelegramApi, escapeHtml, keyboard, type InlineButton } from './telegram.ts';

export type DispatchSummary = { claimed: number; sent: number; skipped: number; failed: number; expired: number };

export async function dispatchReminders(
  { db, telegram, env }: { db: any; telegram: TelegramApi; env: (name: string) => string | undefined },
  { limit = 50 }: { limit?: number } = {},
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, sent: 0, skipped: 0, failed: 0, expired: 0 };

  const claim = await db.rpc('tavro_claim_reminders', { p_limit: limit });
  const due = checked(claim) || [];
  summary.claimed = due.length;

  const appUrl = env('TAVRO_MINIAPP_URL');
  const accounts = new Map<string, any>();

  for (const reminder of due) {
    try {
      let account = accounts.get(reminder.account_id);
      if (!account) {
        account = checked(await db.from('tavro_accounts').select('*').eq('id', reminder.account_id).maybeSingle());
        accounts.set(reminder.account_id, account);
      }
      if (!account || account.deleted_at || !account.reminders_enabled) {
        await mark(db, reminder.id, 'skipped', 'REMINDERS_OFF');
        summary.skipped += 1;
        continue;
      }

      const target = reminder.target_kind === 'task'
        ? checked(await db.from('tavro_tasks').select('id,title,scheduled_for,scheduled_time,completed,deleted_at').eq('id', reminder.target_id).eq('account_id', account.id).maybeSingle())
        : checked(await db.from('tavro_events').select('id,title,event_date,event_time,location,status,deleted_at').eq('id', reminder.target_id).eq('account_id', account.id).maybeSingle());

      // The record went away or is already handled: nothing to remind about.
      if (!target || target.deleted_at || target.completed === true || target.status === 'done' || target.status === 'cancelled') {
        await mark(db, reminder.id, 'skipped', 'TARGET_CLOSED');
        summary.skipped += 1;
        continue;
      }

      const today = todayIn(account.timezone);
      const message = reminder.target_kind === 'task'
        ? taskMessage(target, reminder.kind, today)
        : eventMessage(target, reminder.kind, today);

      const rows: InlineButton[][] = reminder.target_kind === 'task'
        ? [[{ text: '✓ Выполнено', callback_data: `done:${target.id}` }, { text: '→ Завтра', callback_data: `snooze:${target.id}:1` }]]
        : [[{ text: '✓ Прошла', callback_data: `eventdone:${target.id}` }]];
      if (appUrl && /^https:\/\//i.test(appUrl)) rows.push([{ text: '◆ Открыть TAVRO', web_app: { url: appUrl } }]);

      await telegram.sendMessage(account.telegram_id, message, { reply_markup: keyboard(rows) });
      summary.sent += 1;
    } catch {
      // The claim already moved the row out of 'scheduled', so a failure is
      // recorded rather than retried into a duplicate send.
      await mark(db, reminder.id, 'failed', 'SEND_FAILED').catch(() => {});
      summary.failed += 1;
    }
  }

  summary.expired = await expireLapsed(db).catch(() => 0);
  return summary;
}

async function mark(db: any, id: string, status: string, errorCode: string | null) {
  await db.from('tavro_reminders').update({ status, error_code: errorCode, updated_at: new Date().toISOString() }).eq('id', id);
}

function taskMessage(task: any, kind: string, today: string): string {
  const when = formatWhen(task.scheduled_for, task.scheduled_time, today);
  const lead = kind === 'morning' ? 'Сегодня' : 'Скоро';
  return `<b>${lead}</b>\n◆ ${escapeHtml(task.title)}\n<i>${when}</i>`;
}

function eventMessage(event: any, kind: string, today: string): string {
  const when = formatWhen(event.event_date, event.event_time, today);
  const lead = kind === 'day_before' ? 'Завтра встреча' : kind === 'morning' ? 'Сегодня встреча' : 'Скоро встреча';
  const place = event.location ? `\n<i>${escapeHtml(event.location)}</i>` : '';
  return `<b>${lead}</b>\n● ${escapeHtml(event.title)}\n<i>${when}</i>${place}`;
}
