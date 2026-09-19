// Speech-to-text abstraction.
//
// Audio is held in memory for the length of one request and never written to
// disk or to the database: TAVRO stores the transcript the user confirms, not
// the recording. Limits are enforced before a single byte reaches a provider.

import { AppError, fail } from '../../_shared/validation.ts';

/** Telegram voice notes are OggOpus; these bounds keep one request cheap and bounded. */
export const MAX_VOICE_SECONDS = 120;
export const MAX_VOICE_BYTES = 2 * 1024 * 1024;

export type Transcription = { text: string; seconds: number; provider: string };

export interface SpeechProvider {
  readonly name: string;
  transcribe(input: { audio: Uint8Array; mimeType: string; durationSeconds: number; language?: string; signal?: AbortSignal }): Promise<Transcription>;
}

export function assertVoiceWithinLimits(durationSeconds: number, sizeBytes: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) fail('VOICE_INVALID', 'Не удалось прочитать длительность записи.');
  if (durationSeconds > MAX_VOICE_SECONDS)
    fail('VOICE_TOO_LONG', `Голосовое длиннее ${MAX_VOICE_SECONDS} секунд. Отправьте покороче или напишите текстом.`, 413);
  if (sizeBytes > MAX_VOICE_BYTES) fail('VOICE_TOO_LARGE', 'Голосовое слишком большое.', 413);
}

/**
 * Yandex SpeechKit short-audio recognition (`stt:recognize`), which accepts a raw
 * OggOpus body. Longer audio needs the asynchronous API; `MAX_VOICE_SECONDS`
 * keeps TAVRO inside the short-audio contract.
 */
export class YandexSpeechKitProvider implements SpeechProvider {
  name = 'yandex-speechkit';
  private apiKey: string;
  private folderId: string;
  private url: string;
  private fetchImpl: typeof fetch;

  constructor(options: { apiKey: string; folderId: string; url?: string; fetchImpl?: typeof fetch }) {
    if (!options.apiKey || !options.folderId) fail('SPEECH_NOT_CONFIGURED', 'Распознавание речи ещё не настроено.', 503);
    this.apiKey = options.apiKey;
    this.folderId = options.folderId;
    this.url = options.url || 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize';
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async transcribe(input: { audio: Uint8Array; mimeType: string; durationSeconds: number; language?: string; signal?: AbortSignal }): Promise<Transcription> {
    assertVoiceWithinLimits(input.durationSeconds, input.audio.length);
    const query = new URLSearchParams({
      folderId: this.folderId,
      lang: input.language || 'ru-RU',
      format: 'oggopus',
      topic: 'general',
      profanityFilter: 'false',
    });
    const response = await this.fetchImpl(`${this.url}?${query}`, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${this.apiKey}`, 'Content-Type': 'application/octet-stream' },
      body: input.audio as BodyInit,
      signal: AbortSignal.any([input.signal || new AbortController().signal, AbortSignal.timeout(45000)]),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new AppError(
        response.status === 429 ? 'SPEECH_RATE_LIMIT' : 'SPEECH_ERROR',
        response.status === 429 ? 'Сервис распознавания перегружен. Попробуйте ещё раз.' : 'Не удалось распознать голосовое. Попробуйте ещё раз или напишите текстом.',
        response.status === 429 ? 429 : 503,
      );
    }
    const payload = await response.json();
    const recognized = typeof payload?.result === 'string' ? payload.result.trim() : '';
    if (!recognized) fail('SPEECH_EMPTY', 'В записи не слышно речи. Попробуйте ещё раз.', 422);
    return { text: recognized, seconds: input.durationSeconds, provider: this.name };
  }
}

/**
 * Any OpenAI-compatible `/audio/transcriptions` endpoint (Whisper on Groq, a
 * self-hosted faster-whisper, …). Multipart, so it accepts Telegram's OggOpus
 * without transcoding.
 */
export class WhisperCompatibleProvider implements SpeechProvider {
  name: string;
  private apiKey: string;
  private model: string;
  private url: string;
  private fetchImpl: typeof fetch;

  constructor(options: { apiKey: string; model: string; url: string; name?: string; fetchImpl?: typeof fetch }) {
    if (!options.apiKey) fail('SPEECH_NOT_CONFIGURED', 'Распознавание речи ещё не настроено.', 503);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.url = options.url;
    this.name = options.name || 'whisper-compatible';
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async transcribe(input: { audio: Uint8Array; mimeType: string; durationSeconds: number; language?: string; signal?: AbortSignal }): Promise<Transcription> {
    assertVoiceWithinLimits(input.durationSeconds, input.audio.length);
    const form = new FormData();
    form.append('file', new Blob([input.audio as BlobPart], { type: input.mimeType || 'audio/ogg' }), 'voice.ogg');
    form.append('model', this.model);
    form.append('language', (input.language || 'ru-RU').slice(0, 2));
    form.append('response_format', 'json');
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.any([input.signal || new AbortController().signal, AbortSignal.timeout(45000)]),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new AppError('SPEECH_ERROR', 'Не удалось распознать голосовое. Попробуйте ещё раз или напишите текстом.', response.status === 429 ? 429 : 503);
    }
    const payload = await response.json();
    const recognized = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!recognized) fail('SPEECH_EMPTY', 'В записи не слышно речи. Попробуйте ещё раз.', 422);
    return { text: recognized, seconds: input.durationSeconds, provider: this.name };
  }
}

export function speechFromEnv(env: (name: string) => string | undefined, fetchImpl: typeof fetch = fetch): SpeechProvider {
  const name = (env('TAVRO_SPEECH_PROVIDER') || 'yandex').toLowerCase();
  if (name === 'yandex') {
    return new YandexSpeechKitProvider({
      apiKey: env('TAVRO_YANDEX_API_KEY') || '',
      folderId: env('TAVRO_YANDEX_FOLDER_ID') || '',
      url: env('TAVRO_SPEECH_BASE_URL'),
      fetchImpl,
    });
  }
  const url = env('TAVRO_SPEECH_BASE_URL');
  if (!url || !/^https:\/\//i.test(url)) fail('SPEECH_NOT_CONFIGURED', 'Нужен HTTPS адрес сервиса распознавания.', 503);
  return new WhisperCompatibleProvider({
    apiKey: env('TAVRO_SPEECH_API_KEY') || '',
    model: env('TAVRO_SPEECH_MODEL') || 'whisper-large-v3',
    url, name, fetchImpl,
  });
}

export function speechConfigured(env: (name: string) => string | undefined): boolean {
  const name = (env('TAVRO_SPEECH_PROVIDER') || 'yandex').toLowerCase();
  if (name === 'yandex') return Boolean(env('TAVRO_YANDEX_API_KEY') && env('TAVRO_YANDEX_FOLDER_ID'));
  return Boolean(env('TAVRO_SPEECH_API_KEY') && env('TAVRO_SPEECH_BASE_URL'));
}
