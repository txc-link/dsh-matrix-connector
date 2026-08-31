/**
 * natural-chat — turn plain Matrix room messages into DSH agent replies
 * without requiring a slash command.
 *
 * §1 boundary: this adapter knows Matrix protocol shape (roomId, sender,
 * body) and translates it into a runtime dispatch on the local DSH node
 * through the dsh-agora HTTP facade (/dsh-agora/api/dispatch). Agora
 * central remains the durable dispatch ledger; the connector only adds
 * the IM-side trigger and delivery.
 */

import type { MatrixClient } from './matrix-client.js';
import type { GovernedVoiceRequest } from './governed-voice.js';

export interface ChatConfig {
  /** Master switch. When disabled (default), plain messages are ignored. */
  readonly enabled: boolean;
  /** Local DSH web origin (default http://127.0.0.1:3080). */
  readonly dshApiBaseUrl?: string;
  /** Runtime target ref, e.g. dsh:node-home-linux:default. */
  readonly runtimeTargetRef?: string;
  /** Max milliseconds to wait for the agent reply (default 300000). */
  readonly waitTimeoutMs?: number;
  /** roomId → persona instruction prepended to every user message. */
  readonly personas?: Readonly<Record<string, string>>;
  /** Optional room allow-list. Absent = every room the bot can see. */
  readonly rooms?: readonly string[];
  /** Also deliver the reply as voice when speech + security boundary allow it. */
  readonly voice?: boolean;
}

export interface ResolvedChatConfig {
  readonly enabled: boolean;
  readonly dshApiBaseUrl: string;
  readonly runtimeTargetRef?: string;
  readonly waitTimeoutMs: number;
  readonly personas?: Readonly<Record<string, string>>;
  readonly rooms?: readonly string[];
  readonly voice: boolean;
}

export interface DshDispatchInput {
  readonly runtimeTargetRef: string;
  readonly prompt: string;
  readonly idempotencyKey: string;
  readonly waitTimeoutMs: number;
}

export interface DshDispatchResult {
  readonly answer: string;
  readonly dispatchId: string;
}

export interface DshDispatchClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class DshDispatchClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: DshDispatchClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  public async dispatch(input: DshDispatchInput): Promise<DshDispatchResult> {
    const response = await this.fetchImpl(new URL('/dsh-agora/api/dispatch', this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        runtimeTargetRef: input.runtimeTargetRef,
        prompt: input.prompt,
        idempotencyKey: input.idempotencyKey,
        waitTimeoutMs: input.waitTimeoutMs,
      }),
      signal: AbortSignal.timeout(Math.max(15_000, this.timeoutMs)),
    });
    const body = await response.json().catch(() => ({})) as {
      ok?: boolean;
      error?: { message?: string };
      value?: {
        id?: string;
        state?: string;
        answer?: string;
        result_envelope?: { answer?: string } | null;
        latest_progress?: { message?: string } | null;
      } | null;
    };
    if (!response.ok) {
      throw new Error(body.error?.message ?? `DSH dispatch returned HTTP ${response.status}`);
    }
    const value = body.value;
    if (!value) throw new Error('DSH dispatch returned no value');
    const answer = value.result_envelope?.answer
      ?? value.answer
      ?? value.latest_progress?.message
      ?? '';
    if (answer.trim().length > 0) {
      return { answer: answer.trim(), dispatchId: value.id ?? 'unknown' };
    }
    throw new Error(`agent dispatch ${value.id ?? 'unknown'} ended (${value.state ?? 'unknown'}) without an answer`);
  }
}

export interface NaturalChatEvent {
  readonly roomId: string;
  readonly senderMxid: string;
  readonly body: string;
  readonly eventId?: string;
}

export interface NaturalChatDelivery {
  readonly matrix: Pick<MatrixClient, 'sendText'>;
  readonly voiceDelivery?: { deliver(input: GovernedVoiceRequest): Promise<unknown> } | undefined;
  readonly sourceDomain?: string | undefined;
  readonly logger: (...args: unknown[]) => void;
}

export interface HandleNaturalChatOptions {
  readonly config: ResolvedChatConfig;
  readonly dispatch: (input: DshDispatchInput) => Promise<DshDispatchResult>;
  readonly event: NaturalChatEvent;
  readonly delivery: NaturalChatDelivery;
}

export type NaturalChatOutcome =
  | { readonly status: 'disabled' | 'skipped' }
  | { readonly status: 'replied'; readonly text: string }
  | { readonly status: 'error'; readonly message: string };

export async function handleNaturalChat(options: HandleNaturalChatOptions): Promise<NaturalChatOutcome> {
  const { config, dispatch, event, delivery } = options;
  if (!config.enabled || !config.runtimeTargetRef) return { status: 'disabled' };
  if (config.rooms && !config.rooms.includes(event.roomId)) return { status: 'skipped' };
  const body = event.body.trim();
  if (body.length === 0) return { status: 'skipped' };

  const persona = config.personas?.[event.roomId]?.trim();
  const prompt = persona && persona.length > 0 ? `${persona}\n\n用户消息：${body}` : body;
  const idempotencyKey = `matrix-${event.eventId ?? `${event.roomId}:${event.senderMxid}:${Date.now()}`}`;

  try {
    const result = await dispatch({
      runtimeTargetRef: config.runtimeTargetRef,
      prompt,
      idempotencyKey,
      waitTimeoutMs: config.waitTimeoutMs,
    });
    const text = result.answer.trim();
    if (text.length === 0) throw new Error('agent returned an empty reply');
    await delivery.matrix.sendText(event.roomId, text);

    if (config.voice && delivery.voiceDelivery && delivery.sourceDomain) {
      try {
        await delivery.voiceDelivery.deliver({
          roomId: event.roomId,
          text,
          resourceRef: `matrix:${event.roomId}`,
          sourceDomain: delivery.sourceDomain,
          actorRef: config.runtimeTargetRef,
          subjectRef: event.senderMxid,
          purpose: 'companion_chat',
          requestedFields: ['text'],
        });
      } catch (voiceError) {
        delivery.logger('natural chat voice delivery skipped:', voiceError);
      }
    }
    return { status: 'replied', text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    delivery.logger('natural chat dispatch failed:', error);
    await delivery.matrix.sendText(event.roomId, `🤖 agent 响应失败：${message}`).catch(() => {});
    return { status: 'error', message };
  }
}
