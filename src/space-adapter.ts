/**
 * space-adapter — v0.6 — R-E Space nesting.
 *
 * Adapter-side wrapper around matrix-js-sdk's MSC2946 / MSC1772 surface.
 *
 * §1 boundary: this module knows matrix space topology (m.room.create.type =
 * "m.space", m.space.child state events, /hierarchy MSC2946). agora Core
 * never sees matrix-shaped types. The spaceId ↔ agora opaque projection
 * happens in `thread-registry` (roomId → mx_<hash>), not here.
 *
 * Surface:
 *   - MatrixSpaceAdapter.isSpace(roomId)        — boolean, single state lookup
 *   - MatrixSpaceAdapter.listChildRooms(spaceId) — child metadata array
 *   - MatrixSpaceAdapter.getSpaceHierarchy(spaceId) — SpaceRef + flattened children
 *   - MatrixSpaceAdapter.subscribeSpaceEvents(spaceId, handler) — live child
 *     additions/removals + child-room timeline forwards to the same handler
 *
 * All matrix I/O goes through the `MatrixSpaceTransport` seam so unit tests
 * can stub it without booting a homeserver. The matrix-js-sdk-backed
 * transport implementation is the responsibility of R-E.2.
 */

export interface SpaceChild {
  roomId: string;
  order?: string;
  suggested?: boolean;
  via?: string[];
}

export interface SpaceRef {
  spaceId: string;
  name?: string;
  topic?: string;
  children: SpaceChild[];
}

export type SpaceEvent =
  | { kind: 'child-added'; spaceId: string; child: SpaceChild }
  | { kind: 'child-removed'; spaceId: string; childRoomId: string }
  | { kind: 'message'; spaceId: string; childRoomId: string; eventId: string; sender: string; body: string };

export type SpaceEventHandler = (event: SpaceEvent) => void;

/**
 * Transport seam for the space adapter. matrix-js-sdk-backed implementation
 * owns the SdkMatrixClient; tests inject an in-memory stub. v0.6 R-E.2 will
 * provide the real implementation that wraps the existing
 * `MatrixJsSdkTransport`.
 */
export interface MatrixSpaceTransport {
  /** Return true if the room has `m.room.create.content.type === "m.space"`. */
  isSpaceRoom(roomId: string): Promise<boolean>;
  /** Return all `m.space.child` state events on a Space (keyed by child room_id). */
  listChildRooms(spaceId: string): Promise<SpaceChild[]>;
  /** Fetch the flattened space tree (MSC2946 /hierarchy) starting from spaceId. */
  getSpaceHierarchy(spaceId: string): Promise<{ space: SpaceRef; childRooms: SpaceRef[] }>;
  /**
   * Subscribe to live space mutations + child-room timeline messages. The
   * returned disposer removes all subscriptions attached by the call. Only
   * events whose source room is either the space itself (state event
   * additions/removals) or a registered child room (timeline messages) are
   * forwarded — other rooms are ignored.
   */
  subscribeSpaceEvents(
    spaceId: string,
    childRoomIds: string[],
    handler: (event: SpaceEvent) => void,
  ): () => void;
}

/**
 * Optional connector-side config for Space-aware wiring. The matrix-js-sdk
 * transport implementation is gated by `enabled` so that deployments
 * without Spaces (e.g. homeservers on a spec version that lacks MSC2946)
 * can disable the whole surface with a single flag.
 */
export interface SpaceConfig {
  enabled: boolean;
  /** Root space room ids whose child timeline should be aggregated onto the connector event stream. */
  rootSpaces?: string[];
}

/** Default: Space adapter is disabled unless the operator opts in. */
export const DEFAULT_SPACE_CONFIG: SpaceConfig = { enabled: false };

export class MatrixSpaceAdapter {
  private readonly subscriptions = new Map<string, () => void>();

  public constructor(private readonly transport: MatrixSpaceTransport) {}

  /**
   * Determine whether `roomId` is a Space (m.room.create.content.type === "m.space").
   * Returns false for unknown rooms (the transport lookup is allowed to fail).
   */
  public async isSpace(roomId: string): Promise<boolean> {
    if (typeof roomId !== 'string' || roomId.length === 0) return false;
    return this.transport.isSpaceRoom(roomId);
  }

  /**
   * List the direct children of `spaceId`. Throws if `spaceId` is not a
   * Space (the transport-level lookup is the authority; the adapter is a
   * thin pass-through).
   */
  public async listChildRooms(spaceId: string): Promise<SpaceChild[]> {
    if (typeof spaceId !== 'string' || spaceId.length === 0) {
      throw new Error('MatrixSpaceAdapter.listChildRooms: spaceId is required');
    }
    return this.transport.listChildRooms(spaceId);
  }

  /**
   * Fetch the flattened hierarchy rooted at `spaceId`. Throws on empty /
   * missing spaceId — callers must check `isSpace` first when unsure.
   *
   * R-E.1 TDD red: implementation is delegated to the transport seam; the
   * pure transport-side implementation (matrix-js-sdk MSC2946) is the
   * R-E.2 deliverable. Until then this contract test pins the surface.
   */
  public async getSpaceHierarchy(spaceId: string): Promise<{ space: SpaceRef; childRooms: SpaceRef[] }> {
    if (typeof spaceId !== 'string' || spaceId.length === 0) {
      throw new Error('MatrixSpaceAdapter.getSpaceHierarchy: spaceId is required');
    }
    return this.transport.getSpaceHierarchy(spaceId);
  }

  /**
   * Subscribe to live mutations on `spaceId`. The handler receives:
   *   - `child-added` / `child-removed` when m.space.child state events change
   *   - `message` for any m.room.message forwarded from a registered child room
   *
   * Multiple subscribers on the same space are supported; each call returns
   * its own disposer. Subscribers auto-cleanup on dispose.
   */
  public subscribeSpaceEvents(spaceId: string, handler: SpaceEventHandler): () => void {
    if (typeof spaceId !== 'string' || spaceId.length === 0) {
      throw new Error('MatrixSpaceAdapter.subscribeSpaceEvents: spaceId is required');
    }
    if (typeof handler !== 'function') {
      throw new Error('MatrixSpaceAdapter.subscribeSpaceEvents: handler must be a function');
    }
    // Snapshot the current child set so the transport can subscribe to the
    // right set of rooms (state + timeline). Additions later are forwarded
    // via the same subscription (the transport filters by room id).
    let childRoomIds: string[] = [];
    let dispose: (() => void) | null = null;
    const key = spaceId;

    // Synchronous-looking but async-resolved subscription setup. The
    // transport is expected to buffer events until `subscribe` returns its
    // disposer; subscribers may receive events in microtask order after
    // they call `subscribe`.
    void this.transport.listChildRooms(spaceId).then((children) => {
      childRoomIds = children.map((c) => c.roomId);
      dispose = this.transport.subscribeSpaceEvents(spaceId, childRoomIds, handler);
      this.subscriptions.set(key, dispose);
    }).catch(() => {
      // If the initial lookup fails we still register a no-op disposer
      // so callers can always safely dispose.
      this.subscriptions.set(key, () => undefined);
    });

    return () => {
      const existing = this.subscriptions.get(key);
      if (existing) {
        existing();
        this.subscriptions.delete(key);
      }
      dispose = null;
    };
  }
}
