/**
 * src/stuck-alert.ts — v2.0.1 stuck alert.
 *
 * The agora central background scheduler already runs probeInactiveTasks()
 * on a timer and writes an `inbox_escalated` row to flow_log whenever a
 * task has been idle past the escalation policy. The SSE stream surfaces
 * that row as event:tick with type='inbox_escalated'.
 *
 * This module reacts to those events by posting a one-shot summary to
 * the originating Matrix room. Each task_id fires the alert at most
 * once per session. The alert does NOT auto-reassign the task — that
 * would require a Core endpoint we do not have today, and creating
 * one would violate the §1 boundary.
 */

export interface StuckAlertTaskRecord {
  id: string;
  state: string;
  current_stage?: string | null | undefined;
  creator?: string | undefined;
  team: { members: Array<{ role: string; agentId: string }> };
  subtasks?: Array<{ status: string }>;
}

export interface StuckAlertDeps {
  matrix: {
    sendText: (roomId: string, body: string) => Promise<{ eventId: string }>;
  };
  taskBridge: {
    show: (taskId: string) => Promise<StuckAlertTaskRecord>;
  };
  roomForTask: (taskId: string) => string | undefined;
  alerted: Set<string>;
}

export interface StuckAlert {
  handleEvent: (event: { task_id?: string | null; type?: string | null; detail?: unknown }) => Promise<void>;
}

function formatIdle(idleMs: number): string {
  if (idleMs < 1000) return `${idleMs}ms`;
  const s = Math.round(idleMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m${rem}s`;
}

function render(record: StuckAlertTaskRecord, idleMs: number): string {
  const executor = record.team?.members?.find((m) => m.role === 'executor')?.agentId ?? 'unknown';
  const stage = record.current_stage ?? '-';
  const subTotal = record.subtasks?.length ?? 0;
  const subDone = record.subtasks?.filter((s) => s.status === 'completed' || s.status === 'done').length ?? 0;
  return [
    `[agora stuck] task \`${record.id}\``,
    `  idle: ${formatIdle(idleMs)} at stage \`${stage}\``,
    `  creator: ${record.creator ?? '-'}`,
    `  executor: @${executor}`,
    `  subtasks: ${subDone}/${subTotal} done`,
    `  ℹ️  background observation scheduler flagged this task as stuck.`,
    `     Use \`/agora task ${record.id}\` for latest state,`,
    `     or \`/agora stuck\` to see all stuck tasks in this room.`,
  ].join('\n');
}

export function buildStuckAlert(deps: StuckAlertDeps): StuckAlert {
  return {
    async handleEvent(event) {
      const taskId = typeof event.task_id === 'string' ? event.task_id : undefined;
      if (!taskId) return;
      if (event.type !== 'inbox_escalated') return;
      if (deps.alerted.has(taskId)) return;
      const roomId = deps.roomForTask(taskId);
      if (!roomId) return;
      const detail = event.detail as { kind?: string; idle_ms?: number } | null;
      const idleMs = typeof detail?.idle_ms === 'number' ? detail.idle_ms : 0;
      let record: StuckAlertTaskRecord;
      try {
        record = await deps.taskBridge.show(taskId);
      } catch {
        return;
      }
      deps.alerted.add(taskId);
      await deps.matrix.sendText(roomId, render(record, idleMs));
    },
  };
}