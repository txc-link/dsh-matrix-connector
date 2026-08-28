/**
 * src/stuck-list.ts — v2.0.2 /agora stuck renderer.
 *
 * Reads the in-memory set of tasks the plugin has observed stuck via
 * the SSE inbox_escalated stream (one row per task, updated on each
 * alert) and renders a Markdown summary sorted by idle_ms descending.
 *
 * The set is intentionally session-local — a fresh plugin restart
 * simply builds it again from SSE replay. This is consistent with
 * the v0.3 status panel, which is also session-local.
 */

export interface StuckTaskEntry {
  taskId: string;
  idleMs: number;
  stage: string;
  agentId: string;
  roomId: string;
}

export interface RenderStuckListOptions {
  stuckTasks: StuckTaskEntry[];
  rooms?: Set<string>;
}

function formatIdle(idleMs: number): string {
  if (idleMs < 1000) return `${idleMs}ms`;
  const s = Math.round(idleMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m${rem}s`;
}

export function renderStuckList(opts: RenderStuckListOptions): string {
  const rooms = opts.rooms;
  const filtered = rooms
    ? opts.stuckTasks.filter((t) => rooms.has(t.roomId))
    : opts.stuckTasks;

  const sorted = [...filtered].sort((a, b) => b.idleMs - a.idleMs);

  const lines: string[] = [];
  lines.push(`[agora stuck] tasks flagged by the observation scheduler (this session)`);
  lines.push(` ${sorted.length} task(s)`);

  if (sorted.length === 0) {
    lines.push(' (none right now)');
    return lines.join('\n');
  }

  lines.push('');
  for (const t of sorted) {
    lines.push(` - \`${t.taskId}\`  idle ${formatIdle(t.idleMs)} at stage \`${t.stage}\`  executor=@${t.agentId}  room=${t.roomId}`);
  }
  return lines.join('\n');
}