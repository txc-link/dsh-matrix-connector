/**
 * thread-registry — opaque threadKey ↔ matrix room/placeholder mapping.
 *
 * §1 boundary: this is the ONLY place that knows both the agora opaque
 * threadKey and the matrix room_id. agora central never sees room_id;
 * matrix central never sees the threadKey.
 */

import { createHash } from 'node:crypto';

export interface ThreadBinding {
  threadKey: string;
  roomId: string;
  placeholderEventId: string | null;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Build the opaque threadKey the agora central REST will see.
 * v0.1: SHA-256(matrix roomId) prefix, prefixed `mx_` for recognisability.
 */
export function buildThreadKey(roomId: string): string {
  const hash = createHash('sha256').update(roomId).digest('hex').slice(0, 16);
  return `mx_${hash}`;
}

export class ThreadRegistry {
  private readonly bindings = new Map<string, ThreadBinding>();
  private readonly knownRooms = new Set<string>();
  private readonly taskStates = new Map<string, { roomId: string; state: string; agentId: string }>();

  rememberRoom(roomId: string): void {
    if (typeof roomId === 'string' && roomId.length > 0) {
      this.knownRooms.add(roomId);
    }
  }

  rememberTask(taskId: string, roomId: string, state: string, agentId: string): void {
    if (typeof taskId !== 'string' || taskId.length === 0) return;
    this.taskStates.set(taskId, { roomId, state, agentId });
  }

  knownRoomIds(): string[] {
    return Array.from(this.knownRooms);
  }

  taskSummaries(): Array<{ id: string; roomId: string; state: string; agentId: string }> {
    return Array.from(this.taskStates.entries()).map(([id, v]) => ({ id, ...v }));
  }

  upsertPlaceholder(threadKey: string, roomId: string, eventId: string, taskId: string): ThreadBinding {
    const now = new Date().toISOString();
    const existing = this.bindings.get(threadKey);
    const next: ThreadBinding = {
      threadKey,
      roomId,
      placeholderEventId: eventId,
      taskId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.bindings.set(threadKey, next);
    this.rememberRoom(roomId);
    return next;
  }

  resolveTaskId(taskId: string): ThreadBinding | undefined {
    for (const binding of this.bindings.values()) {
      if (binding.taskId === taskId) {
        return binding;
      }
    }
    return undefined;
  }

  get(threadKey: string): ThreadBinding | undefined {
    return this.bindings.get(threadKey);
  }

  has(threadKey: string): boolean {
    return this.bindings.has(threadKey);
  }

  clear(): void {
    this.bindings.clear();
    this.knownRooms.clear();
    this.taskStates.clear();
  }

  size(): number {
    return this.bindings.size;
  }
}