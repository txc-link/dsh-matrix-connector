/**
 * speech-synthesis-http — HTTP JSON TTS provider for Linux/macOS hosts.
 *
 * v0.4.0 — Fish Speech (S2 Pro) adapter. The server already runs on the
 * GPU box at :8080 (`tools/api_server.py` with s2-pro checkpoints), so
 * this adapter adds zero new inference dependencies and was verified
 * end-to-end on 2026-08-31 (JSON POST /v1/tts -> audio/wav).
 *
 * Requests are serialized through a small in-process queue so concurrent
 * voice deliveries never hammer the GPU process. The synthesized text is
 * sent inside a JSON body and never interpolated into a shell command.
 */

import { readWavDurationMs, type SpeechSynthesizer, type SynthesizedSpeech } from './speech-synthesis.js';

export interface FishSpeechSpeechOptions {
  /** Base URL of the Fish Speech api_server, e.g. http://127.0.0.1:8080. */
  readonly baseUrl: string;
  /** Registered reference voice id (see GET /v1/references/list), e.g. 'myvoice'. */
  readonly referenceId?: string;
  /** Per-request timeout in ms (default 30_000). */
  readonly timeoutMs?: number;
  /** Synthesis chunk length (default 200, server schema ge=100 le=1000). */
  readonly chunkLength?: number;
  /** Maximum new tokens (default 1024). */
  readonly maxNewTokens?: number;
  /** Top-p sampling (default 0.8). */
  readonly topP?: number;
  /** Temperature (default 0.8). */
  readonly temperature?: number;
  /** Repetition penalty (default 1.1). */
  readonly repetitionPenalty?: number;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Serialize async work through a promise chain. Concurrency stays at 1 so
 * the GPU TTS process receives one request at a time.
 */
function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export class FishSpeechSpeechAdapter implements SpeechSynthesizer {
  private readonly baseUrl: string;
  private readonly referenceId: string | undefined;
  private readonly timeoutMs: number;
  private readonly chunkLength: number;
  private readonly maxNewTokens: number;
  private readonly topP: number;
  private readonly temperature: number;
  private readonly repetitionPenalty: number;
  private readonly fetchImpl: typeof fetch;
  private readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>;

  public constructor(options: FishSpeechSpeechOptions) {
    if (!options.baseUrl.trim()) throw new Error('fish-speech baseUrl is required');
    this.baseUrl = options.baseUrl.replace(/\/$/u, '');
    this.referenceId = options.referenceId;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.chunkLength = options.chunkLength ?? 200;
    this.maxNewTokens = options.maxNewTokens ?? 1024;
    this.topP = options.topP ?? 0.8;
    this.temperature = options.temperature ?? 0.8;
    this.repetitionPenalty = options.repetitionPenalty ?? 1.1;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.enqueue = createSerialQueue();
  }

  public synthesize(text: string): Promise<SynthesizedSpeech> {
    return this.enqueue(() => this.synthesizeNow(text));
  }

  private async synthesizeNow(text: string): Promise<SynthesizedSpeech> {
    if (!text.trim()) throw new Error('speech text is required');
    const payload: Record<string, unknown> = {
      text,
      format: 'wav',
      streaming: false,
      chunk_length: this.chunkLength,
      max_new_tokens: this.maxNewTokens,
      top_p: this.topP,
      temperature: this.temperature,
      repetition_penalty: this.repetitionPenalty,
    };
    if (this.referenceId) payload.reference_id = this.referenceId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`fish-speech /v1/tts failed: HTTP ${response.status} ${detail.slice(0, 300)}`);
      }
      if (contentType.includes('application/json')) {
        const detail = await response.text().catch(() => '');
        throw new Error(`fish-speech /v1/tts returned JSON instead of audio: ${detail.slice(0, 300)}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 44) throw new Error('fish-speech /v1/tts returned an invalid audio payload');
      return {
        bytes,
        contentType: 'audio/wav',
        filename: `companion-${Date.now()}.wav`,
        durationMs: readWavDurationMs(bytes),
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`fish-speech /v1/tts timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
