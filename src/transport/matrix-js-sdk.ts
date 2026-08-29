/**
 * matrix-js-sdk.ts — real MatrixTransport backed by matrix-js-sdk.
 *
 * v0.4.0 surface:
 *   - connect(homeserverUrl, accessToken, userId) — login via provided token
 *   - startSync / stopSync — matrix /sync lifecycle
 *   - sendRoomMessage — m.room.message (text/html/notice/emote)
 *   - editRoomMessage — m.replace relation
 *   - uploadBytes — mxc:// URI for attachment payloads
 *   - createRoom — name/topic/visibility/preset → room_id
 *   - joinedMembers — user_ids currently joined
 *   - isConnected — lifecycle query
 *   - onTimelineEvent — v0.5 (R-D): raw timeline event subscription
 *     (m.room.message + m.relates_to.m.in_reply_to) for inbound replies
 *
 * Pure mapper methods (buildSendContent, buildEditContent, toSendReceipt,
 * toCreateRoomReceipt) are exposed for unit tests without I/O.
 *
 * v0.4.0 does NOT add E2EE (T-7). initRustCrypto() is called but failure is
 * non-fatal — the transport still works for unencrypted rooms, which is
 * the default per turn 118 E2EE decision (disabled by default).
 */

import { createClient, type MatrixClient as SdkMatrixClient, type Visibility, type Preset, type Room, type MatrixEvent } from 'matrix-js-sdk';
import type {
  MatrixRoomMessage,
  MatrixSendReceipt,
  MatrixEditReceipt,
  MatrixUploadReceipt,
  MatrixTransport,
  MatrixTimelineEvent,
} from '../matrix-client.js';

export interface MatrixJsSdkTransportOptions {
  readonly homeserverUrl: string;
  readonly accessToken: string;
  readonly userId: string;
  readonly deviceId?: string;
}

export interface MatrixJsSdkTransportInternals {
  readonly createClient?: typeof createClient;
}

export interface CreateRoomOptions {
  readonly name?: string;
  readonly topic?: string;
  readonly visibility?: Visibility;
  readonly preset?: Preset;
}

export interface CreateRoomReceipt {
  readonly roomId: string;
}

export class MatrixJsSdkTransport implements MatrixTransport {
  private sdk: SdkMatrixClient | null = null;
  private connected = false;
  private readonly createSdkClient: typeof createClient;

  public constructor(
    private readonly opts: MatrixJsSdkTransportOptions,
    internals: MatrixJsSdkTransportInternals = {},
  ) {
    this.createSdkClient = internals.createClient ?? createClient;
  }

  public async connect(): Promise<void> {
    if (this.connected) return;
    const sdk = this.createSdkClient({
      baseUrl: this.opts.homeserverUrl,
      accessToken: this.opts.accessToken,
      userId: this.opts.userId,
      ...(this.opts.deviceId !== undefined ? { deviceId: this.opts.deviceId } : {}),
    });
    await sdk.startClient({ initialSyncLimit: 0 });
    // Node has no browser IndexedDB. Keep the optional Rust crypto backend
    // in memory so initialization cannot abort the entire DSH host.
    const maybeInitCrypto = (sdk as unknown as {
      initRustCrypto?: (args?: { useIndexedDB?: boolean }) => Promise<void>;
    }).initRustCrypto;
    if (typeof maybeInitCrypto === 'function') {
      try {
        await maybeInitCrypto.call(sdk, { useIndexedDB: false });
      } catch {
        // intentional no-op — unencrypted rooms don't need crypto
      }
    }
    this.sdk = sdk;
    this.connected = true;
    this.attachInviteListener();
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public startSync(): void {
    // matrix-js-sdk's startClient already begins the /sync loop; we leave
    // startSync as a no-op for API symmetry with the stub transport. Real
    // lifecycle control lives in connect()/stopSync().
  }

  /**
   * v0.5 — R-D: subscribe to raw matrix timeline events.
   *
   * matrix-js-sdk fires RoomEvent.Timeline for live /sync events; we
   * translate the SDK event into the adapter-level MatrixTimelineEvent
   * surface (matrix protocol shape only — never reaches agora Core).
   */
  public onTimelineEvent(handler: (event: MatrixTimelineEvent) => void): void {
    if (!this.sdk) return;
    this.sdk.on('Room.timeline' as never, ((event: MatrixEvent, room: Room) => {
      if (!event || !room) return;
      const type = event.getType();
      if (type !== 'm.room.message') return;
      const content = event.getContent() as {
        body?: string;
        'm.relates_to'?: { 'm.in_reply_to'?: { event_id?: string } };
      };
      const sender = event.getSender();
      if (!sender) return;
      const relatesTo = content['m.relates_to']?.['m.in_reply_to']?.event_id
        ? { inReplyTo: { eventId: content['m.relates_to']!['m.in_reply_to']!.event_id! } }
        : undefined;
      handler({
        roomId: room.roomId,
        eventId: event.getId() ?? '',
        sender,
        type,
        ...(content.body !== undefined ? { body: content.body } : {}),
        ...(relatesTo !== undefined ? { relatesTo } : {}),
        originServerTs: event.getTs(),
        isOwn: sender === this.opts.userId,
      });
    }) as never);
  }

  public async stopSync(): Promise<void> {
    if (!this.sdk) return;
    await this.sdk.stopClient();
    this.sdk = null;
    this.connected = false;
  }

  /**
   * v0.1.4 — autoJoin surface. `connect()` may not have run yet when a
   * handler is registered, so invite handlers are buffered and attached
   * as soon as the SDK client exists.
   */
  private inviteHandlers: Array<(roomId: string) => void> = [];

  public onRoomInvite(handler: (roomId: string) => void): void {
    this.inviteHandlers.push(handler);
    if (this.sdk) this.attachInviteListener();
  }

  private inviteListenerAttached = false;

  private attachInviteListener(): void {
    if (!this.sdk || this.inviteListenerAttached) return;
    this.inviteListenerAttached = true;
    this.sdk.on('Room.myMembership' as never, ((room: Room, membership: string) => {
      if (membership === 'invite') {
        for (const handler of this.inviteHandlers) handler(room.roomId);
      }
    }) as never);
  }

  public async joinRoom(roomId: string): Promise<void> {
    if (!this.sdk) throw new Error('matrix transport not connected');
    await this.sdk.joinRoom(roomId);
  }

  /**
   * v0.6 — R-E.2: expose the underlying `SdkMatrixClient` so secondary
   * transports (e.g. `MatrixJsSdkSpaceTransport`) can share the same
   * /sync loop and Room cache. Returns null when not connected.
   *
   * Callers MUST NOT mutate the SDK lifecycle (start/stop); that stays
   * owned by `MatrixJsSdkTransport` itself.
   */
  public getSdk(): SdkMatrixClient | null {
    return this.sdk;
  }

  public async createRoom(options: CreateRoomOptions): Promise<CreateRoomReceipt> {
    this.requireConnected();
    const resp = await this.sdk!.createRoom({
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.topic !== undefined ? { topic: options.topic } : {}),
      ...(options.visibility !== undefined ? { visibility: options.visibility } : {}),
      ...(options.preset !== undefined ? { preset: options.preset } : {}),
    });
    return this.toCreateRoomReceipt(resp);
  }

  public async sendRoomMessage(msg: MatrixRoomMessage): Promise<MatrixSendReceipt> {
    this.requireConnected();
    const content = this.buildSendContent(msg);
    const resp = await this.sdk!.sendEvent(
      msg.roomId,
      'm.room.message' as never,
      content as never,
    );
    return this.toSendReceipt(msg.roomId, resp as { event_id: string });
  }

  public async editRoomMessage(
    roomId: string,
    eventId: string,
    replacement: MatrixRoomMessage,
  ): Promise<MatrixEditReceipt> {
    this.requireConnected();
    const content = this.buildEditContent(eventId, replacement);
    const resp = await this.sdk!.sendEvent(
      roomId,
      'm.room.message' as never,
      content as never,
    );
    return {
      eventId: (resp as { event_id: string }).event_id,
      roomId,
      replaced: true,
    };
  }

  public async uploadBytes(
    filename: string,
    contentType: string,
    bytes: Uint8Array,
  ): Promise<MatrixUploadReceipt> {
    this.requireConnected();
    // matrix-js-sdk@34's TypeScript types narrowed FileType to
    // XMLHttpRequestBodyInit; runtime accepts Uint8Array via fetch but
    // TS@25's lib.dom distinguishes SharedArrayBuffer vs ArrayBuffer.
    // node Buffer is universally accepted and preserves the byte length.
    const buf = Buffer.from(bytes);
    const resp = await this.sdk!.uploadContent(buf, {
      type: contentType,
      name: filename,
    });
    return {
      mxcUri: (resp as { content_uri: string }).content_uri,
      sizeBytes: bytes.length,
    };
  }

  public async joinedMembers(roomId: string): Promise<string[]> {
    this.requireConnected();
    const room = this.sdk!.getRoom(roomId);
    if (!room) return [];
    const members = await room.getMembersWithMembership('join');
    return members.map((m) => m.userId);
  }

  // ─── Pure helpers (exposed for tests) ────────────────────────────────────

  public toCreateRoomReceipt(sdkResp: { room_id: string }): CreateRoomReceipt {
    return { roomId: sdkResp.room_id };
  }

  public toSendReceipt(roomId: string, sdkResp: { event_id: string }): MatrixSendReceipt {
    return { eventId: sdkResp.event_id, roomId };
  }

  public buildSendContent(msg: MatrixRoomMessage): Record<string, unknown> {
    return {
      msgtype: msg.msgType ?? 'm.text',
      body: msg.body,
      ...(msg.formattedBody !== undefined ? { formatted_body: msg.formattedBody } : {}),
      ...(msg.format !== undefined ? { format: msg.format } : {}),
    };
  }

  public buildEditContent(
    originalEventId: string,
    replacement: MatrixRoomMessage,
  ): Record<string, unknown> {
    return {
      msgtype: replacement.msgType ?? 'm.text',
      body: replacement.body,
      ...(replacement.formattedBody !== undefined ? { formatted_body: replacement.formattedBody } : {}),
      ...(replacement.format !== undefined ? { format: replacement.format } : {}),
      'm.new_content': {
        msgtype: replacement.msgType ?? 'm.text',
        body: replacement.body,
        ...(replacement.formattedBody !== undefined ? { formatted_body: replacement.formattedBody } : {}),
        ...(replacement.format !== undefined ? { format: replacement.format } : {}),
      },
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: originalEventId,
      },
    };
  }

  private requireConnected(): void {
    if (!this.connected || !this.sdk) {
      throw new Error('MatrixJsSdkTransport: not connected — call connect() first');
    }
  }
}
