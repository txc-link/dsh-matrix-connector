/**
 * space-transport.ts — v0.6 — R-E Space nesting.
 *
 * matrix-js-sdk-backed implementation of the `MatrixSpaceTransport` seam
 * defined in `src/space-adapter.ts`. Wraps a shared `SdkMatrixClient` so
 * the existing `MatrixJsSdkTransport.onTimelineEvent` (R-D) and this
 * transport's `subscribeSpaceEvents` can share the same /sync loop and
 * SDK Room cache — no double-subscription.
 *
 * Surface (matches src/space-adapter.ts `MatrixSpaceTransport`):
 *   - isSpaceRoom(roomId)             → Room.isSpaceRoom() (state lookup, cheap)
 *   - listChildRooms(spaceId)         → RoomState.getStateEvents("m.space.child")
 *   - getSpaceHierarchy(spaceId)      → SdkMatrixClient.getRoomHierarchy() (MSC2946)
 *   - subscribeSpaceEvents(...)       → RoomStateEvent.Events (filter m.space.child)
 *                                       + reuse SDK Room timeline via MatrixJsSdkTransport
 *
 * §1 boundary: every public method returns matrix-agnostic fields
 * (spaceId/roomId/order/suggested/via) — no `Room`/`RoomState`/`MatrixEvent`
 * leaks to the adapter. The only matrix vocabulary that crosses the seam
 * is `via?`, which is MSC1772 protocol content (SDK type), not UI.
 */

import {
  RoomStateEvent,
  RoomEvent,
  EventType,
  type MatrixClient as SdkMatrixClient,
  type Room,
  type MatrixEvent,
  type RoomState,
} from 'matrix-js-sdk';
import type {
  MatrixSpaceTransport,
  SpaceChild,
  SpaceRef,
  SpaceEvent,
} from '../space-adapter.js';
import { MatrixJsSdkTransport } from './matrix-js-sdk.js';

export interface MatrixJsSdkSpaceTransportOptions {
  /** matrix-js-sdk transport instance to share the SdkMatrixClient with. */
  readonly matrixJsSdkTransport: MatrixJsSdkTransport;
}

interface SdkChildState {
  readonly state_key: string;
  readonly content: {
    order?: string;
    suggested?: boolean;
    via?: string[];
  };
}

export class MatrixJsSdkSpaceTransport implements MatrixSpaceTransport {
  public constructor(
    private readonly opts: MatrixJsSdkSpaceTransportOptions,
  ) {}

  /**
   * Lightweight helper exposed for smoke + tests. Returns the shared
   * SdkMatrixClient; throws if the transport is not yet connected.
   */
  private requireSdk(): SdkMatrixClient {
    const sdk = this.opts.matrixJsSdkTransport.getSdk();
    if (!sdk) {
      throw new Error(
        'MatrixJsSdkSpaceTransport: not connected — call matrixJsSdkTransport.connect() first',
      );
    }
    return sdk;
  }

  public async isSpaceRoom(roomId: string): Promise<boolean> {
    if (typeof roomId !== 'string' || roomId.length === 0) return false;
    const sdk = this.requireSdk();
    const room = sdk.getRoom(roomId);
    if (!room) return false;
    return room.isSpaceRoom();
  }

  public async listChildRooms(spaceId: string): Promise<SpaceChild[]> {
    const sdk = this.requireSdk();
    const room = sdk.getRoom(spaceId);
    if (!room) return [];
    const events = room.currentState.getStateEvents(EventType.SpaceChild);
    // matrix removes an m.space.child link by sending an empty content
    // (`{}`). Filter those out so consumers only see live children.
    return events
      .filter((ev) => {
        const content = ev.getContent() as SdkChildState['content'] | undefined;
        return content !== undefined && Object.keys(content).length > 0;
      })
      .map((ev) => this.toSpaceChild(ev));
  }

  public async getSpaceHierarchy(
    spaceId: string,
  ): Promise<{ space: SpaceRef; childRooms: SpaceRef[] }> {
    const sdk = this.requireSdk();
    const hierarchy = await sdk.getRoomHierarchy(spaceId, /* limit */ undefined, /* maxDepth */ 1);
    const rooms = hierarchy.rooms ?? [];
    const root = rooms.find((r) => r.room_id === spaceId);
    if (!root) {
      throw new Error(
        `MatrixJsSdkSpaceTransport.getSpaceHierarchy: ${spaceId} not found in MSC2946 /hierarchy response`,
      );
    }
    const rootRef = this.toSpaceRef(root);
    const childRooms = rooms
      .filter((r) => r.room_id !== spaceId)
      .map((r) => this.toSpaceRef(r));
    return { space: rootRef, childRooms };
  }

  public subscribeSpaceEvents(
    spaceId: string,
    childRoomIds: string[],
    handler: (event: SpaceEvent) => void,
  ): () => void {
    const sdk = this.requireSdk();
    const room = sdk.getRoom(spaceId);
    if (!room) {
      // Space room not yet joined — return a no-op disposer rather than
      // throw; the adapter-level subscribeSpaceEvents already buffers via
      // a microtask and the caller can dispose safely.
      return () => undefined;
    }

    // Snapshot the current child set so the timeline filter is correct
    // even before the state listener wires up. Additions later are
    // covered by RoomStateEvent.Events.
    let activeChildIds = new Set<string>(childRoomIds);
    const disposers: Array<() => void> = [];

    // 1. RoomStateEvent.Events on the Space room — m.space.child add/remove.
    const onStateEvent = (
      event: MatrixEvent,
      _state: RoomState,
      prevEvent: MatrixEvent | null,
    ): void => {
      if (event.getType() !== EventType.SpaceChild) return;
      const childRoomId = event.getStateKey();
      if (!childRoomId) return;
      const content = event.getContent() as SdkChildState['content'] | undefined;
      if (prevEvent !== null && prevEvent !== undefined) {
        // prevEvent present → this is an update (treat as content refresh,
        // do not flip to child-removed). We forward as child-added with
        // the latest content so the adapter can re-resolve.
        const updated = this.contentToSpaceChild(childRoomId, content);
        handler({
          kind: 'child-added',
          spaceId,
          child: updated,
        });
        activeChildIds.add(childRoomId);
        return;
      }
      // prevEvent null + content empty ⇒ removal (matrix sends {} on remove).
      if (!content || Object.keys(content).length === 0) {
        handler({ kind: 'child-removed', spaceId, childRoomId });
        activeChildIds.delete(childRoomId);
        return;
      }
      const added = this.contentToSpaceChild(childRoomId, content);
      handler({
        kind: 'child-added',
        spaceId,
        child: added,
      });
      activeChildIds.add(childRoomId);
    };
    room.on(RoomStateEvent.Events as never, onStateEvent as never);
    disposers.push(() => {
      room.removeListener(RoomStateEvent.Events as never, onStateEvent as never);
    });

    // 2. RoomEvent.Timeline on the Space room + every known child room.
    // Reuses matrix-js-sdk's existing /sync loop. We deliberately do NOT
    // call matrixJsSdkTransport.onTimelineEvent here — that handler is
    // owned by R-D reply-ingest. This transport gets its own listener
    // that filters child room messages and forwards them as SpaceEvent.
    const onTimeline = (
      event: MatrixEvent,
      eventRoom: Room,
      _toStartOfTimeline: boolean | null,
    ): void => {
      if (!event || !eventRoom) return;
      if (event.getType() !== 'm.room.message') return;
      const roomId = eventRoom.roomId;
      if (roomId !== spaceId && !activeChildIds.has(roomId)) return;
      const sender = event.getSender();
      if (!sender) return;
      const content = event.getContent() as { body?: string } | undefined;
      const body = typeof content?.body === 'string' ? content.body : '';
      handler({
        kind: 'message',
        spaceId,
        childRoomId: roomId,
        eventId: event.getId() ?? '',
        sender,
        body,
      });
    };
    // Attach to every known child room (resolved via SDK cache).
    const attachedChildRooms: Room[] = [];
    for (const childId of childRoomIds) {
      const childRoom = sdk.getRoom(childId);
      if (!childRoom) continue;
      childRoom.on(RoomEvent.Timeline as never, onTimeline as never);
      attachedChildRooms.push(childRoom);
    }
    disposers.push(() => {
      for (const childRoom of attachedChildRooms) {
        childRoom.removeListener(RoomEvent.Timeline as never, onTimeline as never);
      }
    });

    // Attach to the Space room itself.
    room.on(RoomEvent.Timeline as never, onTimeline as never);
    disposers.push(() => {
      room.removeListener(RoomEvent.Timeline as never, onTimeline as never);
    });

    return () => {
      for (const dispose of disposers) dispose();
      disposers.length = 0;
    };
  }

  // ─── Pure mappers (exposed for tests + reuse) ────────────────────────────

  /** Map an `m.space.child` state event to SpaceChild. */
  public toSpaceChild(event: MatrixEvent): SpaceChild {
    const stateKey = event.getStateKey();
    const content = event.getContent() as SdkChildState['content'] | undefined;
    return this.contentToSpaceChild(stateKey ?? '', content);
  }

  /** Map MSC1772 state content to SpaceChild, regardless of source. */
  public contentToSpaceChild(
    roomId: string,
    content: SdkChildState['content'] | undefined,
  ): SpaceChild {
    const child: SpaceChild = { roomId };
    if (content?.order !== undefined) child.order = content.order;
    if (content?.suggested !== undefined) child.suggested = content.suggested;
    if (Array.isArray(content?.via) && content.via.length > 0) {
      child.via = [...content.via];
    }
    return child;
  }

  /** Map a single IHierarchyRoom to SpaceRef. */
  public toSpaceRef(room: {
    room_id: string;
    name?: string;
    topic?: string;
    children_state?: Array<{ state_key: string; content: SdkChildState['content'] }>;
  }): SpaceRef {
    const ref: SpaceRef = {
      spaceId: room.room_id,
      children: Array.isArray(room.children_state)
        ? room.children_state.map((c) =>
            this.contentToSpaceChild(c.state_key, c.content),
          )
        : [],
    };
    if (typeof room.name === 'string' && room.name.length > 0) ref.name = room.name;
    if (typeof room.topic === 'string' && room.topic.length > 0) ref.topic = room.topic;
    return ref;
  }
}