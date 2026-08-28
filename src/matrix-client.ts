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
  msgType?: 'm.text' | 'm.notice' | 'm.emote';
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
}

export class MatrixClient {
  constructor(private readonly transport: MatrixTransport) {}

  async sendText(roomId: string, body: string, opts: { html?: string } = {}): Promise<MatrixSendReceipt> {
    const formattedBody = opts.html;
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
    const formattedBody = opts.html;
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

  startSync(): void {
    this.transport.startSync();
  }

  async stopSync(): Promise<void> {
    await this.transport.stopSync();
  }
}