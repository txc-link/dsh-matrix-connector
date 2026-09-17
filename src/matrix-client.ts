import { marked, Renderer } from 'marked';

const markdownRenderer = new Renderer();
markdownRenderer.html = ({ text }) => escapeHtml(text);
markdownRenderer.link = function link({ href, title, tokens }) {
  const safe = safeHref(href);
  if (!safe) return this.parser.parseInline(tokens);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(safe)}"${titleAttr}>${this.parser.parseInline(tokens)}</a>`;
};
markdownRenderer.image = ({ text }) => escapeHtml(text);

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeHref(value: string): string | null {
  const href = String(value ?? '').trim();
  if (/^(?:https?:|mailto:|mxc:)/iu.test(href)) return href;
  if (/^[#/]/u.test(href)) return href;
  return null;
}

/**
 * Keep short chat replies as Matrix body-only text. Structured/long replies
 * are documents and receive Matrix HTML so Element can render them.
 */
export function isDocumentMarkdown(value: string): boolean {
  const text = String(value ?? '');
  if (text.length >= 500) return true;
  if (text.split(/\r?\n/u).length < 2) return false;
  return /^(?:#{1,6}\s|\s*[-*+]\s+|\s*\d+[.)]\s+)/mu.test(text)
    || /```|`[^`]+`|\[[^\]]+\]\([^)]*\)|\|[^\n]+\||\*\*[^*]+\*\*/u.test(text);
}

export function markdownToHtml(value: string): string {
  const source = String(value ?? '');
  try {
    return marked.parse(source, {
      renderer: markdownRenderer,
      gfm: true,
      breaks: true,
    }) as string;
  } catch {
    return `<p>${escapeHtml(source).replace(/\r?\n/gu, '<br />')}</p>`;
  }
}

/**
 * matrix-client — thin wrapper around matrix-js-sdk.
 *
 * v0.1 surface:
 *   - login (via provided accessToken, no password flow)
 *   - /sync long-poll (matrix-js-sdk internal)
 *   - sendTextMessage (text + optional html body)
 *   - editMessage (replace an existing m.room.message)
 *   - uploadMxc (read bytes → upload → return mxc:// URI)
 *
 * All public methods accept a transport seam so unit tests can mock the SDK.
 */

export interface MatrixRoomMessage {
  roomId: string;
  senderMxid: string;
  body: string;
  formattedBody?: string;
  format?: 'org.matrix.custom.html';
  msgType?: 'm.text' | 'm.notice' | 'm.emote' | 'm.audio' | 'm.file';
  url?: string;
  info?: {
    duration?: number;
    mimetype: string;
    size: number;
  };
  /** MSC3245 marker; standard m.audio fields remain the portable baseline. */
  voice?: Record<string, never>;
}

export interface MatrixAudioInput {
  readonly filename: string;
  readonly body: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly durationMs: number;
  readonly voice?: boolean;
}

export interface MatrixFileInput {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface MatrixSendReceipt {
  eventId: string;
  roomId: string;
}

export interface MatrixEditReceipt {
  eventId: string;
  roomId: string;
  replaced: true;
}

export interface MatrixUploadReceipt {
  mxcUri: string;
  sizeBytes: number;
}

export interface MatrixTransport {
  sendRoomMessage(msg: MatrixRoomMessage): Promise<MatrixSendReceipt>;
  editRoomMessage(roomId: string, eventId: string, replacement: MatrixRoomMessage): Promise<MatrixEditReceipt>;
  uploadBytes(filename: string, contentType: string, bytes: Uint8Array): Promise<MatrixUploadReceipt>;
  startSync(): void;
  stopSync(): Promise<void>;
  // v0.3.2 — return the user_ids currently joined to a room.
  joinedMembers?(roomId: string): Promise<string[]>;
  // v0.5 — R-D: subscribe to raw matrix timeline events (m.room.message
  // with m.relates_to). The handler receives the raw event payload;
  // matrix protocol parsing lives in the adapter, never in agora Core.
  onTimelineEvent?(handler: (event: MatrixTimelineEvent) => void): void;
  // v0.1.4 — autoJoin surface: accept pending room invites. Optional so
  // legacy stub transports stay source-compatible.
  joinRoom?(roomId: string): Promise<void>;
  onRoomInvite?(handler: (roomId: string) => void): void;
}

/**
 * v0.5 — R-D: raw matrix timeline event surface handed to plugin wiring.
 * This is matrix protocol shape (adapter side). It is translated into
 * opaque fields (see reply-ingest.ts) before reaching agora Core.
 */
export interface MatrixTimelineEvent {
  roomId: string;
  eventId: string;
  sender: string;
  type: string;
  body?: string;
  relatesTo?: { inReplyTo?: { eventId?: string } };
  originServerTs?: number;
  isOwn?: boolean;
}

/**
 * v0.4.0 — optional room creator surface. Real MatrixTransport
 * implementations (matrix-js-sdk) implement this; legacy stubs do not.
 * `MatrixClient.createRoom` checks for it before delegating.
 */
export interface MatrixRoomCreator {
  createRoom(options: {
    name?: string;
    topic?: string;
    visibility?: 'public' | 'private';
    preset?: 'private_chat' | 'public_chat' | 'trusted_private_chat';
  }): Promise<{ roomId: string }>;
}

export interface CreateRoomArgs {
  readonly name?: string;
  readonly topic?: string;
  readonly visibility?: 'public' | 'private';
  readonly preset?: 'private_chat' | 'public_chat' | 'trusted_private_chat';
}

export class MatrixClient {
  constructor(private readonly transport: MatrixTransport) {}

  async sendText(roomId: string, body: string, opts: { html?: string } = {}): Promise<MatrixSendReceipt> {
    const formattedBody = opts.html ?? (isDocumentMarkdown(body) ? markdownToHtml(body) : undefined);
    return this.transport.sendRoomMessage({
      roomId,
      senderMxid: '',
      body,
      ...(formattedBody !== undefined ? { formattedBody } : {}),
      ...(formattedBody !== undefined ? { format: 'org.matrix.custom.html' as const } : {}),
      msgType: 'm.text',
    });
  }

  async edit(roomId: string, eventId: string, body: string, opts: { html?: string } = {}): Promise<MatrixEditReceipt> {
    const formattedBody = opts.html ?? (isDocumentMarkdown(body) ? markdownToHtml(body) : undefined);
    return this.transport.editRoomMessage(roomId, eventId, {
      roomId,
      senderMxid: '',
      body,
      ...(formattedBody !== undefined ? { formattedBody } : {}),
      ...(formattedBody !== undefined ? { format: 'org.matrix.custom.html' as const } : {}),
      msgType: 'm.text',
    });
  }

  async uploadMxc(filename: string, contentType: string, bytes: Uint8Array): Promise<MatrixUploadReceipt> {
    return this.transport.uploadBytes(filename, contentType, bytes);
  }

  async sendAudio(roomId: string, input: MatrixAudioInput): Promise<MatrixSendReceipt> {
    const upload = await this.uploadMxc(input.filename, input.contentType, input.bytes);
    return this.transport.sendRoomMessage({
      roomId,
      senderMxid: '',
      body: input.body,
      msgType: 'm.audio',
      url: upload.mxcUri,
      info: {
        duration: input.durationMs,
        mimetype: input.contentType,
        size: upload.sizeBytes,
      },
      ...(input.voice === true ? { voice: {} } : {}),
    });
  }

  async sendFile(roomId: string, input: MatrixFileInput): Promise<MatrixSendReceipt> {
    const upload = await this.uploadMxc(input.filename, input.contentType, input.bytes);
    return this.transport.sendRoomMessage({
      roomId,
      senderMxid: '',
      body: input.filename,
      msgType: 'm.file',
      url: upload.mxcUri,
      info: {
        mimetype: input.contentType,
        size: upload.sizeBytes,
      },
    });
  }

  // v0.3.2 — return the joined room members' user_ids, or an empty
  // array if the transport does not implement the lookup.
  async joinedMembers(roomId: string): Promise<string[]> {
    if (typeof this.transport.joinedMembers !== 'function') return [];
    return this.transport.joinedMembers(roomId);
  }

  // v0.5 — R-D: subscribe to raw matrix timeline events. No-op when the
  // transport does not implement the subscription surface.
  onTimelineEvent(handler: (event: MatrixTimelineEvent) => void): void {
    if (typeof this.transport.onTimelineEvent !== 'function') return;
    this.transport.onTimelineEvent(handler);
  }

  // v0.1.4 — autoJoin surface, forwarded to the transport when present.
  async joinRoom(roomId: string): Promise<void> {
    if (typeof this.transport.joinRoom !== 'function') {
      throw new Error('transport does not support joinRoom');
    }
    await this.transport.joinRoom(roomId);
  }

  onRoomInvite(handler: (roomId: string) => void): void {
    if (typeof this.transport.onRoomInvite !== 'function') return;
    this.transport.onRoomInvite(handler);
  }

  startSync(): void {
    this.transport.startSync();
  }

  async stopSync(): Promise<void> {
    await this.transport.stopSync();
  }

  /**
   * v0.4.0 — create a matrix room. Requires the transport to implement
   * the optional MatrixRoomCreator surface (matrix-js-sdk-backed
   * transports do; legacy stubs do not). Throws a clear error otherwise.
   */
  async createRoom(args: CreateRoomArgs): Promise<{ roomId: string }> {
    const t = this.transport as unknown as Partial<MatrixRoomCreator>;
    if (typeof t.createRoom !== 'function') {
      throw new Error(
        'MatrixClient.createRoom: underlying transport does not implement createRoom() — ' +
        'use a matrix-js-sdk-backed transport.',
      );
    }
    const opts: { name?: string; topic?: string; visibility?: 'public'|'private'; preset?: 'private_chat'|'public_chat'|'trusted_private_chat' } = {};
    if (args.name !== undefined) opts.name = args.name;
    if (args.topic !== undefined) opts.topic = args.topic;
    if (args.visibility !== undefined) opts.visibility = args.visibility;
    if (args.preset !== undefined) opts.preset = args.preset;
    return t.createRoom(opts);
  }
}
