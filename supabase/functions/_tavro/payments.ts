// Telegram Stars payments.
//
// Access is granted only from a payment Telegram itself confirmed, through the
// `successful_payment` server update — never from a client message, a callback
// or a Mini App claim. Every grant is idempotent on
// `telegram_payment_charge_id`, which is the primary key of the ledger, so a
// redelivered webhook credits nothing twice.

import { checked, fail, text } from '../_shared/validation.ts';
import {
  PLANS, SUBSCRIPTION_PERIOD_SECONDS, TERMS_VERSION, fairUseNotice,
  invoicePayload, parseInvoicePayload, periodEndAfterPayment, planOf, starsFor,
  type PlanId,
} from './billing.ts';
import type { Account } from './store.ts';
import type { TelegramApi } from './telegram.ts';

export type SuccessfulPayment = {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
  subscription_expiration_date?: number;
  is_recurring?: boolean;
  is_first_recurring?: boolean;
};

export type GrantResult = {
  applied: boolean;
  plan: PlanId;
  expiresAt: string | null;
  duplicate: boolean;
};

/** Builds a Stars invoice link, or explains why the plan cannot be sold yet. */
export async function createInvoice(
  telegram: TelegramApi, env: (name: string) => string | undefined,
  account: Account, plan: PlanId,
): Promise<{ url: string; stars: number }> {
  const definition = PLANS[plan];
  if (!definition || plan === 'free') fail('VALIDATION', 'Этот тариф нельзя купить.');
  const stars = starsFor(plan, env);
  if (stars === null) {
    fail('PRICE_NOT_CONFIGURED',
      'Цена в Telegram Stars пока не настроена на сервере. Покупка временно недоступна — напишите в поддержку.', 503);
  }

  const nonce = crypto.randomUUID().slice(0, 8);
  const url = await telegram.createInvoiceLink({
    title: `TAVRO ${definition.title}`,
    description: `${definition.summary}\n\n${fairUseNotice(plan)}`.slice(0, 255),
    payload: invoicePayload(plan, account.id, nonce),
    amount: stars,
    // Only the monthly plan is a real Telegram subscription. A yearly or
    // lifetime purchase must not be presented as auto-renewing.
    ...(definition.billing === 'subscription' ? { subscriptionPeriod: SUBSCRIPTION_PERIOD_SECONDS } : {}),
  });
  return { url, stars };
}

/**
 * Validates a pre-checkout request. Telegram gives roughly ten seconds, and a
 * request we cannot tie to this account's own invoice is declined rather than
 * charged and sorted out later.
 */
export function validatePreCheckout(query: { invoice_payload: string; currency: string; total_amount: number }, account: Account, env: (name: string) => string | undefined): { ok: true; plan: PlanId } | { ok: false; reason: string } {
  let parsed: { plan: PlanId; accountId: string };
  try { parsed = parseInvoicePayload(query.invoice_payload); }
  catch { return { ok: false, reason: 'Счёт не распознан. Откройте тарифы заново.' }; }

  if (parsed.accountId !== account.id) return { ok: false, reason: 'Счёт выписан другому аккаунту.' };
  if (query.currency !== 'XTR') return { ok: false, reason: 'Поддерживается оплата только в Telegram Stars.' };

  const expected = starsFor(parsed.plan, env);
  if (expected === null) return { ok: false, reason: 'Цена изменилась. Откройте тарифы заново.' };
  if (query.total_amount !== expected) return { ok: false, reason: 'Цена изменилась. Откройте тарифы заново.' };
  return { ok: true, plan: parsed.plan };
}

/**
 * Records the payment and grants access. The ledger insert is the idempotency
 * gate: a duplicate charge id means the webhook was redelivered, and the
 * subscription is left exactly as the first delivery set it.
 */
export async function grantFromPayment(db: any, account: Account, payment: SuccessfulPayment, now = Date.now()): Promise<GrantResult> {
  const chargeId = text(payment.telegram_payment_charge_id, 128, { field: 'идентификатор платежа' });
  const parsed = parseInvoicePayload(payment.invoice_payload);
  if (parsed.accountId !== account.id) fail('PAYMENT_MISMATCH', 'Платёж относится к другому аккаунту.', 403);
  const plan = planOf(parsed.plan);

  const ledger = await db.from('tavro_payments').insert({
    telegram_payment_charge_id: chargeId,
    account_id: account.id,
    plan,
    stars: payment.total_amount,
    currency: payment.currency || 'XTR',
    invoice_payload: payment.invoice_payload,
    is_recurring: payment.is_recurring === true,
    is_first_recurring: payment.is_first_recurring === true,
    subscription_expiration_date: payment.subscription_expiration_date
      ? new Date(payment.subscription_expiration_date * 1000).toISOString() : null,
  }).select('telegram_payment_charge_id');

  if (ledger.error) {
    if (ledger.error.code === '23505') {
      const current = checked(await db.from('tavro_subscriptions').select('plan,current_period_end').eq('account_id', account.id).maybeSingle());
      return { applied: false, duplicate: true, plan, expiresAt: current?.current_period_end ?? null };
    }
    fail('DATABASE_ERROR', 'Не удалось записать платёж.', 503);
  }

  const existing = checked(await db.from('tavro_subscriptions').select('*').eq('account_id', account.id).maybeSingle());
  // A lifetime grant is never downgraded by a later, shorter purchase.
  if (existing?.plan === 'pro_lifetime' && existing.status === 'active' && plan !== 'pro_lifetime') {
    return { applied: false, duplicate: false, plan: 'pro_lifetime', expiresAt: null };
  }

  const expiresAt = periodEndAfterPayment(plan, {
    now,
    currentEnd: existing?.plan === plan ? existing.current_period_end : null,
    telegramExpiration: payment.subscription_expiration_date ?? null,
  });

  checked(await db.from('tavro_subscriptions').upsert({
    account_id: account.id,
    plan,
    status: 'active',
    current_period_end: expiresAt,
    auto_renew: PLANS[plan].billing === 'subscription',
    telegram_charge_id: chargeId,
    // Terms are frozen at purchase and not rewritten by a later release.
    terms_version: existing?.terms_version || TERMS_VERSION,
    updated_at: new Date(now).toISOString(),
    ...(existing ? {} : { granted_at: new Date(now).toISOString() }),
  }, { onConflict: 'account_id' }).select('account_id').single());

  return { applied: true, duplicate: false, plan, expiresAt };
}

/** Marks a refunded charge and drops the access it paid for. */
export async function applyRefund(db: any, accountId: string, chargeId: string): Promise<boolean> {
  const rows = checked(await db.from('tavro_payments')
    .update({ status: 'refunded', refunded_at: new Date().toISOString() })
    .eq('telegram_payment_charge_id', text(chargeId, 128, { field: 'идентификатор платежа' }))
    .eq('account_id', accountId).eq('status', 'paid')
    .select('telegram_payment_charge_id,plan'));
  if (!rows?.length) return false;

  const subscription = checked(await db.from('tavro_subscriptions').select('*').eq('account_id', accountId).maybeSingle());
  if (subscription?.telegram_charge_id === chargeId) {
    // Data is never deleted with access: the planner keeps working on FREE.
    checked(await db.from('tavro_subscriptions').update({
      plan: 'free', status: 'refunded', current_period_end: null, auto_renew: false, updated_at: new Date().toISOString(),
    }).eq('account_id', accountId).select('account_id').single());
  }
  return true;
}

/** Stops auto-renewal without removing the access already paid for. */
export async function cancelSubscription(db: any, telegram: TelegramApi, account: Account): Promise<{ ok: boolean; message: string }> {
  const subscription = checked(await db.from('tavro_subscriptions').select('*').eq('account_id', account.id).maybeSingle());
  if (!subscription || subscription.plan === 'free') return { ok: false, message: 'Активной подписки нет.' };
  if (PLANS[subscription.plan as PlanId]?.billing !== 'subscription') {
    return { ok: false, message: 'Этот тариф куплен разово — его не нужно отменять, он не продлевается автоматически.' };
  }
  if (!subscription.telegram_charge_id) return { ok: false, message: 'Не нашёл платёж для отмены. Напишите в поддержку.' };

  await telegram.editUserStarSubscription(account.telegram_id, subscription.telegram_charge_id, true);
  checked(await db.from('tavro_subscriptions').update({
    auto_renew: false, status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('account_id', account.id).select('account_id').single());

  const until = subscription.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString('ru-RU') : null;
  return { ok: true, message: until ? `Автопродление отключено. PRO работает до ${until}.` : 'Автопродление отключено.' };
}

/** Expires lapsed periods. Safe to run repeatedly; lifetime is never touched. */
export async function expireLapsed(db: any, now = Date.now()): Promise<number> {
  const rows = checked(await db.from('tavro_subscriptions')
    .update({ status: 'expired', auto_renew: false, updated_at: new Date(now).toISOString() })
    .in('status', ['active', 'cancelled'])
    .not('current_period_end', 'is', null)
    .lt('current_period_end', new Date(now).toISOString())
    .select('account_id'));
  return rows?.length || 0;
}
