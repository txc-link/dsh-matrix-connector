/**
 * src/post-mortem.ts — v0.3.1 war room post-mortem.
 *
 * Subscribes to agora SSE ticks. For every task that already has a
 * room binding, pulls the latest task record and posts a one-shot
 * summary message to the room when a subtask completes or any output
 * exists. Each task_id fires the summary at most once per session.
 *
 * Why this is plugin-local and not a Core concept:
 *   - The summary text format is IM-specific (Matrix markdown).
 *   - The de-dup set is session-local (a fresh session may legitimately
 *     re-post after a restart, which is fine — we only avoid spamming
 *     within one session).
 *   - The room-binding map is owned by the plugin's ThreadRegistry,
 *     not by agora central.
 */

export interface PostMortemTaskRecord {
  id: string;
  state: string;
  team: { members: Array<{ role: string; agentId: string }> };
  subtasks?: Array<{
    status: string;
    output?: string | null;
    done_at?: string | null;
  }>;
  artifacts?: Array<{ artifact_id?: string; name?: string }>;
}

export interface PostMortemDeps {
  matrix: {
    sendText: (roomId: string, body: string) => Promise<{ eventId: string }>;
  };
  taskBridge: {
    show: (taskId: string) => Promise<PostMortemTaskRecord>;
  };
  roomForTask: (taskId: string) => string | undefined;
  posted: Set<string>;
}

export interface PostMortem {
  handleTick: (event: { task_id?: string | null }) => Promise<void>;
}

const MAX_OUTPUT_CHARS = 240;

function truncate(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_OUTPUT_CHARS - 3)}...`;
}

function executorAgentId(record: PostMortemTaskRecord): string | undefined {
  const executor = record.team?.members?.find((m) => m.role === 'executor');
  return executor?.agentId;
}

function hasFinishedSubtask(record: PostMortemTaskRecord): boolean {
  if (!Array.isArray(record.subtasks) || record.subtasks.length === 0) return false;
  return record.subtasks.some(
    (s) => s.status === 'completed' || (typeof s.output === 'string' && s.output.length > 0),
  );
}

function render(record: PostMortemTaskRecord): string {
  const executor = executorAgentId(record) ?? 'unknown';
  const sub = record.subtasks?.[0];
  const output = typeof sub?.output === 'string' && sub.output.length > 0
    ? truncate(sub.output)
    : '(no output)';
  const artifactCount = Array.isArray(record.artifacts) ? record.artifacts.length : 0;
  return [
    `[agora post-mortem] task \`${record.id}\``,
    `  executor: @${executor}`,
    `  state: ${record.state}`,
    `  subtasks: ${record.subtasks?.filter((s) => s.status === 'completed').length ?? 0}/${record.subtasks?.length ?? 0} done`,
    `  output: ${output}`,
    `  artifacts: ${artifactCount} uploaded`,
  ].join('\n');
}

export function buildPostMortem(deps: PostMortemDeps): PostMortem {
  return {
    async handleTick(event) {
      const taskId = typeof event.task_id === 'string' ? event.task_id : undefined;
      if (!taskId) return;
      if (deps.posted.has(taskId)) return;
      const roomId = deps.roomForTask(taskId);
      if (!roomId) return;
      let record: PostMortemTaskRecord;
      try {
        record = await deps.taskBridge.show(taskId);
      } catch {
        return;
      }
      if (!hasFinishedSubtask(record)) return;
      deps.posted.add(taskId);
      await deps.matrix.sendText(roomId, render(record));
    },
  };
}