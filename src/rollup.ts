/**
 * src/rollup.ts — v1.0.1 org war-room rollup view.
 *
 * Renders a Markdown summary of every room this plugin instance has
 * seen and every task it currently knows about. The view is read-only
 * and derived entirely from in-memory state (ThreadRegistry +
 * remembered rooms). No new agora central endpoint is called.
 *
 * Why this lives in the plugin (§1):
 *   - The rollup is an IM-shaped Markdown rendering; the underlying
 *     data is owned by agora central but the projection is IM-side.
 *   - The plugin's in-memory room/task set is precisely the union of
 *     rooms and tasks it has observed. agora central cannot tell us
 *     which subset is relevant to this Matrix deployment.
 */

export interface RollupTask {
  id: string;
  roomId: string;
  state: string;
  agentId: string;
}

export interface RollupInput {
  rooms: string[];
  tasks: RollupTask[];
}

export function renderRollup(input: RollupInput): string {
  const seen = new Set<string>();
  const dedupedTasks: RollupTask[] = [];
  for (const t of input.tasks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    dedupedTasks.push(t);
  }

  const roomSet = new Set(input.rooms);

  // Group tasks by room.
  const byRoom = new Map<string, RollupTask[]>();
  for (const t of dedupedTasks) {
    if (!roomSet.has(t.roomId)) continue;
    const list = byRoom.get(t.roomId) ?? [];
    list.push(t);
    byRoom.set(t.roomId, list);
  }

  // Render per-room lines.
  const roomLines: string[] = [];
  for (const roomId of input.rooms) {
    const list = byRoom.get(roomId) ?? [];
    const active = list.filter((t) => t.state !== 'done' && t.state !== 'failed').length;
    const done = list.filter((t) => t.state === 'done' || t.state === 'failed').length;
    roomLines.push(` ${roomId}: ${list.length} task(s) (${active} active, ${done} done)`);
  }

  // Render per-task lines (deduped).
  const taskLines: string[] = dedupedTasks.map((t) =>
    ` ${t.id}  @${t.agentId}  state=${t.state}  room=${t.roomId}`,
  );

  return [
    '[org war room] today\'s org-wide activity:',
    ` ${input.rooms.length} room(s), ${dedupedTasks.length} task(s)`,
    '',
    'Per-room:',
    ...(roomLines.length > 0 ? roomLines : [' (no rooms seen yet)']),
    '',
    'Per-task:',
    ...(taskLines.length > 0 ? taskLines : [' (no tasks yet)']),
  ].join('\n');
}