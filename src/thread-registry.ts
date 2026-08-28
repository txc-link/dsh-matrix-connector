/**
 * thread-registry — opaque threadKey ↔ matrix room/placeholder mapping.
 *
 * §1 boundary: this is the ONLY place that knows both the agora opaque
 * threadKey and the matrix room_id. agora central never sees room_id;
 * matrix central never sees the threadKey.
 *
 * v0.4 (R4): JSONL persistence. loadThreadRegistry / saveThreadRegistry
 * follow the audit-trail sandbox pattern — default path is
 * ~/.agora/registry/thread-registry.jsonl with workspace-relative fallback
 * on EROFS/ENOENT.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

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

  /**
   * v0.4 (R4): upsert a full binding (used by JSONL load + room auto-create).
   * Preserves createdAt from an existing binding when the caller omits it.
   */
  upsert(binding: ThreadBinding): ThreadBinding {
    const now = new Date().toISOString();
    const existing = this.bindings.get(binding.threadKey);
    const next: ThreadBinding = {
      ...binding,
      createdAt: binding.createdAt ?? existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.bindings.set(next.threadKey, next);
    this.rememberRoom(next.roomId);
    return next;
  }

  /** v0.4 (R4): reverse lookup — find the binding owning a matrix roomId. */
  getByRoomId(roomId: string): ThreadBinding | undefined {
    for (const binding of this.bindings.values()) {
      if (binding.roomId === roomId) {
        return binding;
      }
    }
    return undefined;
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

  /** v0.4 (R4): snapshot of every binding (persistence support). */
  allBindings(): ThreadBinding[] {
    return Array.from(this.bindings.values());
  }
}

export const DEFAULT_REGISTRY_PATH: string = join(
  homedir(),
  '.agora',
  'registry',
  'thread-registry.jsonl',
);

/**
 * Resolve the registry path with sandbox fallback (same pattern as
 * audit-trail): 1. AGORA_REGISTRY_PATH env, 2. ~/.agora/registry/…,
 * 3. workspace-relative .agora/registry/….
 */
export function resolveRegistryPath(): string {
  const envPath = process.env.AGORA_REGISTRY_PATH;
  if (envPath) return envPath;

  const homePath = DEFAULT_REGISTRY_PATH;
  const homeDir = dirname(homePath);
  try {
    if (!existsSync(homeDir)) {
      mkdirSync(homeDir, { recursive: false });
    }
    return homePath;
  } catch (e) {
    return join(process.cwd(), '.agora', 'registry', 'thread-registry.jsonl');
  }
}

/**
 * Load a ThreadRegistry from a JSONL file. ENOENT (missing file) is not an
 * error — returns an empty registry (v0.4 sandbox/EPHEMERAL-friendly).
 */
export function loadThreadRegistry(path: string): ThreadRegistry {
  const registry = new ThreadRegistry();
  if (!existsSync(path)) {
    return registry;
  }
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const binding = JSON.parse(line) as ThreadBinding;
      if (typeof binding?.threadKey === 'string' && typeof binding?.roomId === 'string') {
        registry.upsert(binding);
      }
    } catch (e) {
      // Skip malformed lines; the registry stays usable.
    }
  }
  return registry;
}

/**
 * Persist every binding as one JSONL line. Creates the parent directory.
 */
export function saveThreadRegistry(registry: ThreadRegistry, path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const lines = registry.allBindings().map((b) => JSON.stringify(b));
  writeFileSync(path, lines.length > 0 ? lines.join('\n') + '\n' : '', 'utf-8');
}