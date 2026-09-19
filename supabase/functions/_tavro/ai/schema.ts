// Strict schema for everything a language model returns to TAVRO.
//
// The model is treated as an untrusted parser, not as an authority. Its output
// is narrowed field by field here; anything unexpected is rejected rather than
// coerced. In particular a model may not emit an absolute instant for a date the
// user never said: it emits either an explicit calendar date, a token from a
// closed relative vocabulary, or null — and null stays null.

import { day as isDay, fail, integer, list, object, oneOf, text } from '../../_shared/validation.ts';
import { RELATIVE_TOKENS, resolveRelative } from '../../_shared/datetime.ts';

export const ITEM_TYPES = ['task', 'event', 'note', 'diary', 'meal', 'habit'] as const;
export type ItemType = typeof ITEM_TYPES[number];

export const ITEM_LABELS: Record<ItemType, string> = {
  task: 'Задача', event: 'Встреча', note: 'Заметка', diary: 'Дневник', meal: 'Питание', habit: 'Привычка',
};

const TASK_KEYS = ['type', 'title', 'details', 'date', 'time', 'duration_minutes', 'category', 'priority'];
const EVENT_KEYS = ['type', 'title', 'details', 'date', 'time', 'duration_minutes', 'location', 'participants'];
const NOTE_KEYS = ['type', 'title', 'body', 'date'];
const HABIT_KEYS = ['type', 'title'];

const KEYS_BY_TYPE: Record<ItemType, string[]> = {
  task: TASK_KEYS, event: EVENT_KEYS, note: NOTE_KEYS, diary: NOTE_KEYS, meal: NOTE_KEYS, habit: HABIT_KEYS,
};

const MAX_ABSOLUTE_YEARS = 5;

export type ResolvedDate = { date: string | null; source: 'absolute' | 'relative' | 'none'; token: string | null };

/**
 * Accepts `null`, `{ "relative": "tomorrow" }` or `{ "absolute": "2026-09-20" }`.
 * A bare string is accepted only when it is a full calendar date, so a model that
 * writes "завтра" into an absolute field fails loudly instead of inventing a day.
 */
export function resolveDateField(raw: unknown, today: string): ResolvedDate {
  if (raw === null || raw === undefined || raw === '') return { date: null, source: 'none', token: null };

  if (typeof raw === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) fail('AI_SCHEMA', 'Модель вернула дату в неизвестном формате.');
    return { date: assertPlausible(isDay(raw), today), source: 'absolute', token: null };
  }

  const value = object(raw, 'Модель вернула дату в неизвестном формате.');
  const keys = Object.keys(value);
  if (keys.length !== 1 || (keys[0] !== 'relative' && keys[0] !== 'absolute'))
    fail('AI_SCHEMA', 'Модель вернула дату в неизвестном формате.');

  if (keys[0] === 'absolute') {
    return { date: assertPlausible(isDay(value.absolute), today), source: 'absolute', token: null };
  }
  const token = String(value.relative);
  const allowed = (RELATIVE_TOKENS as readonly string[]).includes(token) || /^in_\d{1,3}_days$/.test(token);
  if (!allowed) fail('AI_SCHEMA', 'Модель вернула неизвестную относительную дату.');
  return { date: resolveRelative(token, today), source: 'relative', token };
}

function assertPlausible(date: string, today: string): string {
  const distance = Math.abs(Date.parse(date) - Date.parse(today)) / 86400000;
  if (distance > MAX_ABSOLUTE_YEARS * 366) fail('AI_SCHEMA', 'Дата слишком далеко от сегодняшнего дня.');
  return date;
}

export function timeField(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) fail('AI_SCHEMA', 'Модель вернула некорректное время.');
  return raw as string;
}

export type CaptureItem = {
  type: ItemType;
  title: string;
  details: string | null;
  body: string | null;
  date: string | null;
  dateSource: ResolvedDate['source'];
  dateToken: string | null;
  time: string | null;
  durationMinutes: number | null;
  category: string | null;
  priority: boolean;
  location: string | null;
  participants: string[];
};

export type CaptureDraft = {
  items: CaptureItem[];
  clarification: { question: string; itemIndex: number | null } | null;
  today: string;
};

export const MAX_ITEMS = 12;

/**
 * Validates one model item. Unknown keys are a hard error: a model that starts
 * inventing fields is a model whose other output we should not trust either.
 */
function parseItem(raw: unknown, today: string): CaptureItem {
  const value = object(raw, 'Модель вернула запись в неизвестном формате.');
  const type = oneOf(value.type, ITEM_TYPES, 'тип записи');
  const allowedKeys = KEYS_BY_TYPE[type];
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) fail('AI_SCHEMA', `Недопустимое поле «${key}» в записи.`);
  }

  const isNoteLike = type === 'note' || type === 'diary' || type === 'meal';
  const title = isNoteLike
    ? text(value.title ?? value.body, 200, { field: 'заголовок' }).slice(0, 200)
    : text(value.title, 200, { field: 'название' });

  const resolved = resolveDateField(value.date ?? null, today);

  const participants = value.participants === undefined || value.participants === null
    ? []
    : list(value.participants, 20, 'участников').map(entry => text(entry, 80, { field: 'участника' }));

  return {
    type,
    title,
    details: value.details === undefined || value.details === null || value.details === '' ? null : text(value.details, 2000, { field: 'описание' }),
    body: isNoteLike ? text(value.body ?? value.title, 4000, { field: 'текст записи' }) : null,
    date: resolved.date,
    dateSource: resolved.source,
    dateToken: resolved.token,
    time: type === 'habit' ? null : timeField(value.time ?? null),
    durationMinutes: value.duration_minutes === undefined || value.duration_minutes === null ? null : integer(value.duration_minutes, 1, 1440),
    category: value.category === undefined || value.category === null || value.category === '' ? null : text(value.category, 80, { field: 'категорию' }),
    priority: value.priority === true,
    location: value.location === undefined || value.location === null || value.location === '' ? null : text(value.location, 200, { field: 'место' }),
    participants,
  };
}

/** Parses the whole model reply into a draft the user can review and confirm. */
export function parseCaptureResult(raw: unknown, today: string): CaptureDraft {
  const value = object(raw, 'Модель вернула ответ в неизвестном формате.');
  const rawItems = list(value.items ?? [], MAX_ITEMS, 'записи');
  const items = rawItems.map(item => parseItem(item, today));

  let clarification: CaptureDraft['clarification'] = null;
  if (value.clarification !== undefined && value.clarification !== null) {
    const asked = object(value.clarification, 'Модель вернула уточнение в неизвестном формате.');
    const index = asked.item_index === undefined || asked.item_index === null ? null : integer(asked.item_index, 0, MAX_ITEMS - 1);
    if (index !== null && index >= items.length) fail('AI_SCHEMA', 'Уточнение ссылается на несуществующую запись.');
    clarification = { question: text(asked.question, 300, { field: 'вопрос' }), itemIndex: index };
  }

  if (!items.length && !clarification) fail('AI_EMPTY', 'Не удалось распознать ни одной записи. Попробуйте сказать конкретнее.');
  return { items, clarification, today };
}

/** Deduplicates items that the model split twice out of one phrase. */
export function dedupeItems(items: CaptureItem[]): CaptureItem[] {
  const seen = new Set<string>();
  const unique: CaptureItem[] = [];
  for (const item of items) {
    const key = `${item.type}|${item.title.toLowerCase()}|${item.date || ''}|${item.time || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}
