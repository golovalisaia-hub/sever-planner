// AI provider abstraction.
//
// TAVRO talks to one interface. Swapping Yandex for an OpenAI-compatible
// endpoint (or the reverse) is a change to server environment variables, never a
// change to the bot, the Mini App or the database. Every adapter returns parsed
// JSON plus usage counters; none of them is allowed to reach a database or a
// secret beyond its own API key.

import { AppError, fail, object } from '../../_shared/validation.ts';

export type AiUsage = { inputTokens: number; outputTokens: number };

export type AiCompletion = { json: Record<string, unknown>; usage: AiUsage; raw: string };

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  complete(input: { system: string; user: string; signal?: AbortSignal; maxTokens?: number }): Promise<AiCompletion>;
}

const MAX_RESPONSE_CHARS = 24000;

function parseJsonReply(raw: string): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) fail('AI_PROVIDER', 'Модель вернула пустой ответ.', 503);
  if (raw.length > MAX_RESPONSE_CHARS) fail('AI_PROVIDER', 'Слишком длинный ответ модели.', 503);
  // Some models wrap JSON in a fenced block even in JSON mode.
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(raw);
  const candidate = fenced ? fenced[1] : raw;
  try { return object(JSON.parse(candidate), 'Модель вернула не объект.'); }
  catch (error) {
    if (error instanceof AppError) throw error;
    return fail('AI_PROVIDER', 'Модель вернула некорректный JSON.', 503);
  }
}

async function postJson(url: string, init: RequestInit, fetchImpl: typeof fetch, timeoutMs: number) {
  const signal = AbortSignal.any([init.signal || new AbortController().signal, AbortSignal.timeout(timeoutMs)]);
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetchImpl(url, { ...init, signal });
    if (![502, 503, 504].includes(response.status) || attempt === 1) break;
    await response.body?.cancel().catch(() => {});
  }
  if (!response!.ok) {
    const status = response!.status;
    await response!.body?.cancel().catch(() => {});
    throw new AppError(
      status === 429 ? 'AI_RATE_LIMIT' : 'AI_PROVIDER',
      status === 429 ? 'Сейчас слишком много запросов к ИИ. Попробуйте через минуту.' : 'ИИ временно недоступен. Планер работает как обычно.',
      status === 429 ? 429 : 503,
    );
  }
  return response!.json();
}

/**
 * Yandex Foundation Models (YandexGPT) text completion.
 * Auth is an API key of a service account; `folderId` scopes the model URI.
 */
export class YandexGptProvider implements AIProvider {
  name = 'yandex';
  model: string;
  private apiKey: string;
  private folderId: string;
  private url: string;
  private fetchImpl: typeof fetch;

  constructor(options: { apiKey: string; folderId: string; model?: string; url?: string; fetchImpl?: typeof fetch }) {
    if (!options.apiKey || !options.folderId) fail('AI_NOT_CONFIGURED', 'ИИ ещё не настроен на сервере.', 503);
    this.apiKey = options.apiKey;
    this.folderId = options.folderId;
    this.model = options.model || 'yandexgpt/latest';
    this.url = options.url || 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async complete(input: { system: string; user: string; signal?: AbortSignal; maxTokens?: number }): Promise<AiCompletion> {
    const body = {
      modelUri: `gpt://${this.folderId}/${this.model}`,
      completionOptions: { stream: false, temperature: 0.1, maxTokens: String(input.maxTokens || 2000), reasoningOptions: { mode: 'DISABLED' } },
      jsonObject: true,
      messages: [
        { role: 'system', text: input.system },
        { role: 'user', text: input.user },
      ],
    };
    const payload = await postJson(this.url, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${this.apiKey}`, 'Content-Type': 'application/json', 'x-folder-id': this.folderId },
      body: JSON.stringify(body),
      signal: input.signal,
    }, this.fetchImpl, 30000);

    const alternative = payload?.result?.alternatives?.[0];
    const raw = alternative?.message?.text;
    if (typeof raw !== 'string') fail('AI_PROVIDER', 'Модель вернула пустой ответ.', 503);
    const usage = payload?.result?.usage || {};
    return {
      json: parseJsonReply(raw),
      raw,
      usage: { inputTokens: Number(usage.inputTextTokens) || 0, outputTokens: Number(usage.completionTokens) || 0 },
    };
  }
}

/**
 * Any OpenAI-compatible Chat Completions endpoint (Groq, Mistral, OpenRouter,
 * a self-hosted gateway). Kept protocol-based rather than vendor-specific.
 */
export class OpenAICompatibleProvider implements AIProvider {
  name: string;
  model: string;
  private apiKey: string;
  private url: string;
  private fetchImpl: typeof fetch;

  constructor(options: { apiKey: string; model: string; url: string; name?: string; fetchImpl?: typeof fetch }) {
    if (!options.apiKey) fail('AI_NOT_CONFIGURED', 'ИИ ещё не настроен на сервере.', 503);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.url = options.url;
    this.name = options.name || 'openai-compatible';
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async complete(input: { system: string; user: string; signal?: AbortSignal; maxTokens?: number }): Promise<AiCompletion> {
    const payload = await postJson(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        max_tokens: input.maxTokens || 2000,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.user }],
      }),
      signal: input.signal,
    }, this.fetchImpl, 30000);

    const raw = payload?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') fail('AI_PROVIDER', 'Модель вернула пустой ответ.', 503);
    const usage = payload?.usage || {};
    return {
      json: parseJsonReply(raw),
      raw,
      usage: { inputTokens: Number(usage.prompt_tokens) || 0, outputTokens: Number(usage.completion_tokens) || 0 },
    };
  }
}

const HTTPS_URL = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/|$)/i;

const DEFAULT_URLS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

/** Builds the configured provider, or fails loudly if the operator has not set one. */
export function providerFromEnv(env: (name: string) => string | undefined, fetchImpl: typeof fetch = fetch): AIProvider {
  const name = (env('TAVRO_AI_PROVIDER') || 'yandex').toLowerCase();

  if (name === 'yandex') {
    return new YandexGptProvider({
      apiKey: env('TAVRO_YANDEX_API_KEY') || '',
      folderId: env('TAVRO_YANDEX_FOLDER_ID') || '',
      model: env('TAVRO_AI_MODEL') || 'yandexgpt/latest',
      url: env('TAVRO_AI_BASE_URL'),
      fetchImpl,
    });
  }

  if (name === 'groq' || name === 'mistral' || name === 'openrouter' || name === 'openai-compatible') {
    const url = env('TAVRO_AI_BASE_URL') || DEFAULT_URLS[name];
    if (!url || !HTTPS_URL.test(url)) fail('AI_NOT_CONFIGURED', 'Нужен HTTPS адрес провайдера ИИ.', 503);
    const model = env('TAVRO_AI_MODEL');
    if (!model) fail('AI_NOT_CONFIGURED', 'Не выбрана модель ИИ.', 503);
    return new OpenAICompatibleProvider({ apiKey: env('TAVRO_AI_API_KEY') || '', model, url, name, fetchImpl });
  }

  return fail('AI_NOT_CONFIGURED', 'Неизвестный провайдер ИИ.', 503);
}

export function aiConfigured(env: (name: string) => string | undefined): boolean {
  const name = (env('TAVRO_AI_PROVIDER') || 'yandex').toLowerCase();
  if (name === 'yandex') return Boolean(env('TAVRO_YANDEX_API_KEY') && env('TAVRO_YANDEX_FOLDER_ID'));
  return Boolean(env('TAVRO_AI_API_KEY') && env('TAVRO_AI_MODEL'));
}
