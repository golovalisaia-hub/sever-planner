// TAVRO plans, entitlements and Telegram Stars pricing.
//
// Two rules shape this file:
//  1. Ruble prices are fixed by the product owner and are not computed here.
//  2. Star prices are *server configuration*, never a constant compiled into the
//     bot. Telegram's Star economics (purchase rate, developer payout share) are
//     a platform parameter that changes without our release cycle, so an
//     unconfigured price disables the purchase instead of guessing one.
//
// Fair-use allowances are part of the offer: they are shown before purchase and
// frozen into the subscription row as `terms_version`, so a plan already bought
// keeps the terms it was bought under.

import { fail, oneOf } from '../_shared/validation.ts';

export const PLAN_IDS = ['free', 'pro_month', 'pro_year', 'pro_lifetime'] as const;
export type PlanId = typeof PLAN_IDS[number];
export const PAID_PLAN_IDS = ['pro_month', 'pro_year', 'pro_lifetime'] as const;

export const TERMS_VERSION = 'v1';

/** 30 days, the only value Telegram currently accepts for Star subscriptions. */
export const SUBSCRIPTION_PERIOD_SECONDS = 2592000;

export type Plan = {
  id: PlanId;
  title: string;
  rub: number;
  /** Renewal shape. 'subscription' auto-renews; 'one_time' does not, and is never described as renewing. */
  billing: 'free' | 'subscription' | 'one_time';
  durationDays: number | null;
  /** Billable AI actions per day. One phrase = one action, however many records it yields. */
  dailyAiActions: number;
  starsEnv: string;
  summary: string;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free', title: 'FREE', rub: 0, billing: 'free', durationDays: null,
    dailyAiActions: 3, starsEnv: '',
    summary: 'Планер целиком: задачи, встречи, календарь, заметки, дневник, привычки, напоминания. 3 AI-действия в день.',
  },
  pro_month: {
    id: 'pro_month', title: 'PRO — месяц', rub: 250, billing: 'subscription', durationDays: 30,
    dailyAiActions: 100, starsEnv: 'TAVRO_STARS_PRO_MONTH',
    summary: 'Автопродление каждые 30 дней. 100 AI-действий в день. Отмена в любой момент.',
  },
  pro_year: {
    id: 'pro_year', title: 'PRO — год', rub: 1800, billing: 'one_time', durationDays: 365,
    dailyAiActions: 100, starsEnv: 'TAVRO_STARS_PRO_YEAR',
    summary: 'Разовая покупка на 365 дней. 100 AI-действий в день. Без автопродления.',
  },
  pro_lifetime: {
    id: 'pro_lifetime', title: 'PRO — навсегда', rub: 5000, billing: 'one_time', durationDays: null,
    dailyAiActions: 50, starsEnv: 'TAVRO_STARS_PRO_LIFETIME',
    summary: 'Разовая покупка, доступ без срока. 50 AI-действий в день по условиям честного использования.',
  },
};

export const planOf = (value: unknown): PlanId => oneOf(value, PLAN_IDS, 'тариф');

/**
 * Star price for a plan, in whole Stars. Returns null when the operator has not
 * configured one — the purchase flow then explains that rather than inventing a
 * rate. Telegram accepts 1–2500 Stars per invoice item.
 */
export function starsFor(plan: PlanId, env: (name: string) => string | undefined): number | null {
  const definition = PLANS[plan];
  if (!definition.starsEnv) return null;
  const configured = Number(env(definition.starsEnv));
  if (!Number.isInteger(configured) || configured < 1 || configured > 2500) return null;
  return configured;
}

/** Star prices that are actually sellable right now. */
export function sellablePlans(env: (name: string) => string | undefined): { plan: Plan; stars: number }[] {
  const offers: { plan: Plan; stars: number }[] = [];
  for (const id of PAID_PLAN_IDS) {
    const stars = starsFor(id, env);
    if (stars !== null) offers.push({ plan: PLANS[id], stars });
  }
  return offers;
}

export type Subscription = {
  account_id: string;
  plan: PlanId;
  status: 'active' | 'cancelled' | 'expired' | 'refunded';
  current_period_end: string | null;
  auto_renew: boolean;
  telegram_charge_id: string | null;
  terms_version: string;
};

export type Entitlement = {
  plan: PlanId;
  pro: boolean;
  dailyAiActions: number;
  expiresAt: string | null;
  autoRenew: boolean;
  status: string;
  /** True when a paid plan lapsed and the account fell back to FREE. */
  lapsed: boolean;
};

const FREE_ENTITLEMENT: Entitlement = {
  plan: 'free', pro: false, dailyAiActions: PLANS.free.dailyAiActions,
  expiresAt: null, autoRenew: false, status: 'active', lapsed: false,
};

/**
 * Single source of truth for "what may this account do right now".
 * Access is derived from the stored subscription, never from a client claim, and
 * an expired period silently degrades to FREE without touching the user's data.
 */
export function entitlementOf(subscription: Subscription | null, now: Date | number = Date.now()): Entitlement {
  if (!subscription || subscription.plan === 'free') return FREE_ENTITLEMENT;
  const definition = PLANS[subscription.plan];
  if (!definition) return FREE_ENTITLEMENT;
  if (subscription.status === 'refunded' || subscription.status === 'expired') return { ...FREE_ENTITLEMENT, lapsed: true };

  const instant = typeof now === 'number' ? now : now.getTime();
  const expiresAt = subscription.current_period_end;
  // Lifetime carries no period end and never lapses.
  if (expiresAt) {
    const end = Date.parse(expiresAt);
    if (!Number.isFinite(end)) return { ...FREE_ENTITLEMENT, lapsed: true };
    if (end <= instant) return { ...FREE_ENTITLEMENT, lapsed: true };
  } else if (definition.durationDays !== null) {
    // A time-limited plan with no recorded end is not a valid grant.
    return { ...FREE_ENTITLEMENT, lapsed: true };
  }

  return {
    plan: subscription.plan,
    pro: true,
    dailyAiActions: definition.dailyAiActions,
    expiresAt,
    autoRenew: subscription.auto_renew && subscription.status === 'active',
    status: subscription.status,
    lapsed: false,
  };
}

/**
 * Period end after a successful payment. Renewals extend from the later of "now"
 * and the current end, so paying early never shortens access. Telegram's own
 * `subscription_expiration_date` wins when it is present, because the platform
 * owns the renewal clock for Star subscriptions.
 */
export function periodEndAfterPayment(
  plan: PlanId,
  { now = Date.now(), currentEnd = null, telegramExpiration = null }:
  { now?: number; currentEnd?: string | null; telegramExpiration?: number | null } = {},
): string | null {
  const definition = PLANS[plan];
  if (!definition) fail('VALIDATION', 'Неизвестный тариф.');
  if (definition.durationDays === null) return null; // lifetime
  if (telegramExpiration) {
    const fromTelegram = telegramExpiration * 1000;
    if (Number.isFinite(fromTelegram) && fromTelegram > now) return new Date(fromTelegram).toISOString();
  }
  const existing = currentEnd ? Date.parse(currentEnd) : 0;
  const base = Number.isFinite(existing) && existing > now ? existing : now;
  return new Date(base + definition.durationDays * 86400000).toISOString();
}

/** Invoice payload: plan + account + nonce, so a replayed payload cannot be re-credited. */
export function invoicePayload(plan: PlanId, accountId: string, nonce: string): string {
  return `tavro:${TERMS_VERSION}:${plan}:${accountId}:${nonce}`;
}

export function parseInvoicePayload(payload: unknown): { plan: PlanId; accountId: string; nonce: string } {
  if (typeof payload !== 'string' || payload.length > 200) fail('VALIDATION', 'Некорректные данные платежа.');
  const parts = (payload as string).split(':');
  if (parts.length !== 5 || parts[0] !== 'tavro') fail('VALIDATION', 'Некорректные данные платежа.');
  return { plan: planOf(parts[2]), accountId: parts[3], nonce: parts[4] };
}

/** The fair-use text a buyer sees *before* paying, especially for lifetime. */
export function fairUseNotice(plan: PlanId): string {
  const definition = PLANS[plan];
  const base = `${definition.dailyAiActions} AI-действий в день. Одна фраза — одно действие, сколько бы записей она ни создала.`;
  if (plan === 'pro_lifetime') {
    return `${base}\n\nПожизненный доступ — это доступ к TAVRO без срока и без повторной оплаты. AI-часть работает на платных внешних сервисах, поэтому у неё есть дневная норма: ${definition.dailyAiActions} действий в сутки. Норму для уже купленного тарифа мы не снижаем. Планер, напоминания и все записи остаются доступны без ограничения по количеству.`;
  }
  return base;
}
