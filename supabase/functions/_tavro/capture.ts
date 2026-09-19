// The core TAVRO flow: one phrase in, several reviewable records out.
//
// One phrase is one billable AI action, however many records it yields. The
// quota is claimed *before* the provider is called and released if the provider
// fails, so a user is never charged for an outage, and a retried Telegram update
// with the same request id cannot claim twice.

import { AppError, checked, fail, text as textField } from '../_shared/validation.ts';
import { clockIn, formatWhen, todayIn } from '../_shared/datetime.ts';
import { capturePrompt } from './ai/prompt.ts';
import { dedupeItems, parseCaptureResult, ITEM_LABELS, type CaptureDraft, type CaptureItem } from './ai/schema.ts';
import type { AIProvider } from './ai/provider.ts';
import type { Account, TavroStore } from './store.ts';
import type { Entitlement } from './billing.ts';
import { escapeHtml } from './telegram.ts';

export const MAX_PHRASE_CHARS = 2000;

const WEEKDAY_NAMES = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

export type CaptureOutcome = {
  captureId: string;
  draft: CaptureDraft;
  items: CaptureItem[];
  clarification: CaptureDraft['clarification'];
  requestId: string;
};

export type QuotaState = { allowed: boolean; limit: number; plan: string };

/** Claims one AI action against the account's daily allowance. */
export async function claimAiAction(
  db: any, account: Account, entitlement: Entitlement, requestId: string, kind: 'capture' | 'ask' | 'transcribe' | 'photo',
  provider?: string, model?: string,
): Promise<QuotaState> {
  const usageDate = todayIn(account.timezone);
  const result = await db.rpc('tavro_claim_ai_action', {
    p_account: account.id, p_request_id: requestId, p_kind: kind,
    p_usage_date: usageDate, p_limit: entitlement.dailyAiActions,
    p_provider: provider ?? null, p_model: model ?? null,
  });
  if (result.error?.code === '23505') fail('ALREADY_PROCESSED', 'Этот запрос уже обработан.', 409);
  const allowed = checked(result) === true;
  return { allowed, limit: entitlement.dailyAiActions, plan: entitlement.plan };
}

export async function releaseAiAction(db: any, requestId: string, errorCode: string): Promise<void> {
  try { await db.rpc('tavro_release_ai_action', { p_request_id: requestId, p_error: errorCode }); }
  catch { /* Accounting must never turn a user-visible failure into a second one. */ }
}

async function finishAiAction(db: any, requestId: string, patch: Record<string, unknown>): Promise<void> {
  try { await db.from('tavro_ai_usage').update(patch).eq('request_id', requestId); } catch { /* see above */ }
}

/**
 * Runs one capture. `requestId` is supplied by the caller (derived from the
 * Telegram update or the Mini App request) so a retry is idempotent.
 */
export async function runCapture(
  { db, store, provider }: { db: any; store: TavroStore; provider: AIProvider },
  input: { account: Account; entitlement: Entitlement; phrase: string; source: 'text' | 'voice' | 'photo' | 'miniapp' | 'quick'; requestId: string; transcript?: string | null; chatId?: number | null; signal?: AbortSignal; billable?: boolean },
): Promise<CaptureOutcome> {
  const account = input.account;
  const phrase = textField(input.phrase, MAX_PHRASE_CHARS, { field: 'фразу' });

  // A voice note already spent this phrase's action on transcription; parsing it
  // is the same user action, so it is recorded but not charged again.
  const billable = input.billable !== false;
  const budget = billable ? input.entitlement : { ...input.entitlement, dailyAiActions: -1 };
  const quota = await claimAiAction(db, account, budget, input.requestId, 'capture', provider.name, provider.model);
  if (!quota.allowed) {
    fail('QUOTA_EXCEEDED',
      `Дневной лимит ИИ исчерпан: ${quota.limit} ${plural(quota.limit, 'действие', 'действия', 'действий')} в сутки на тарифе ${quota.plan === 'free' ? 'FREE' : 'PRO'}. Записи можно создавать вручную в приложении — планер не ограничен.`,
      429);
  }

  const today = todayIn(account.timezone);
  const weekday = WEEKDAY_NAMES[(new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7];
  const started = Date.now();

  let draft: CaptureDraft;
  let usage = { inputTokens: 0, outputTokens: 0 };
  try {
    const completion = await provider.complete({
      system: capturePrompt({ today, weekday, now: clockIn(account.timezone) }),
      // The phrase is wrapped as data, not appended to the instructions.
      user: JSON.stringify({ phrase }),
      signal: input.signal,
    });
    usage = completion.usage;
    draft = parseCaptureResult(completion.json, today);
    draft.items = dedupeItems(draft.items);
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'AI_ERROR';
    await releaseAiAction(db, input.requestId, code);
    throw error;
  }

  await finishAiAction(db, input.requestId, {
    latency_ms: Date.now() - started,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    success: true,
    billable,
  });

  const capture = await store.createCapture(account.id, {
    source: input.source,
    rawText: input.source === 'voice' ? null : phrase,
    transcript: input.transcript ?? (input.source === 'voice' ? phrase : null),
    draft: { items: draft.items, clarification: draft.clarification, today },
    chatId: input.chatId ?? null,
    aiRequestId: input.requestId,
  });

  return { captureId: capture.id, draft, items: draft.items, clarification: draft.clarification, requestId: input.requestId };
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const ITEM_ICONS: Record<string, string> = { task: '◆', event: '●', note: '▸', diary: '✎', meal: '⊙', habit: '↻' };

/** The preview a user checks before saving — in Telegram HTML. */
export function previewMessage(draft: CaptureDraft, options: { transcript?: string | null } = {}): string {
  const lines: string[] = [];
  if (options.transcript) lines.push(`<i>«${escapeHtml(options.transcript)}»</i>`, '');

  if (!draft.items.length) {
    lines.push('Пока не получилось выделить записи.');
  } else {
    lines.push(`<b>Нашёл ${draft.items.length} ${plural(draft.items.length, 'запись', 'записи', 'записей')}</b>`, '');
    draft.items.forEach((item, index) => {
      const when = formatWhen(item.date, item.time, draft.today);
      const icon = ITEM_ICONS[item.type] || '•';
      lines.push(`${icon} <b>${escapeHtml(item.title)}</b>`);
      const meta = [ITEM_LABELS[item.type], when];
      if (item.location) meta.push(escapeHtml(item.location));
      if (item.participants.length) meta.push(escapeHtml(item.participants.join(', ')));
      lines.push(`    <i>${meta.join(' · ')}</i>`);
      if (index < draft.items.length - 1) lines.push('');
    });
  }

  if (draft.clarification) {
    lines.push('', `❓ ${escapeHtml(draft.clarification.question)}`);
  }
  return lines.join('\n');
}

/** The same preview as data, for the Mini App to render in its own style. */
export function previewPayload(draft: CaptureDraft) {
  return {
    today: draft.today,
    clarification: draft.clarification,
    items: draft.items.map(item => ({
      type: item.type,
      label: ITEM_LABELS[item.type],
      title: item.title,
      details: item.details,
      body: item.body,
      date: item.date,
      time: item.time,
      when: formatWhen(item.date, item.time, draft.today),
      durationMinutes: item.durationMinutes,
      location: item.location,
      participants: item.participants,
      category: item.category,
      priority: item.priority,
    })),
  };
}

/** Confirmation summary after the records actually exist. */
export function savedMessage(records: { kind: string; title: string; date: string | null; time: string | null }[], today: string): string {
  if (!records.length) return 'Нечего было сохранять.';
  const lines = [`<b>Сохранено: ${records.length} ${plural(records.length, 'запись', 'записи', 'записей')}</b>`, ''];
  for (const record of records) {
    const icon = ITEM_ICONS[record.kind] || '•';
    lines.push(`${icon} ${escapeHtml(record.title)} <i>· ${formatWhen(record.date, record.time, today)}</i>`);
  }
  return lines.join('\n');
}
