/**
 * src/status-panel.ts — v0.3.3 war-room status panel.
 *
 * Each Matrix room with at least one known task gets a single panel
 * message. The panel is created on the first tick and edited on
 * subsequent ticks for the same room. The panel body lists each
 * in-room task with its executor agentId, current state, and stage.
 *
 * The panel is owned by the plugin (panelEventId stored in the
 * ThreadRegistry). It is intentionally NOT persisted to agora
 * central: a fresh session will simply create a new panel.
 */

export interface StatusPanelTaskRecord {
  id: string;
  state: string;
  team: { members: Array<{ role: string; agentId: string }> };
  current_stage?: string | null;
}

export interface StatusPanelDeps {
  matrix: {
    sendText: (roomId: string, body: string) => Promise<{ eventId: string }>;
    edit: (roomId: string, eventId: string, body: string) => Promise<{ eventId: string }>;
  };
  taskBridge: {
    show: (taskId: string) => Promise<StatusPanelTaskRecord>;
  };
  roomTasks: Map<string, Set<string>>;
  roomId: string;
}

export interface StatusPanel {
  handleTick: (taskId: string) => Promise<void>;
  panelEventId: () => string | undefined;
}

function render(tasks: Array<StatusPanelTaskRecord>): string {
  if (tasks.length === 0) return '[war room] no in-room tasks';
  const lines = tasks.map((t) => {
    const exec = t.team?.members?.find((m) => m.role === 'executor');
    const agent = exec?.agentId ?? 'unknown';
    const stage = t.current_stage ?? '-';
    return ` \`${t.id}\`  @${agent}  state=${t.state}  stage=${stage}`;
  });
  return `[war room] ${tasks.length} task(s) in this room:\n${lines.join('\n')}`;
}

export function buildStatusPanel(deps: StatusPanelDeps): StatusPanel {
  let eventId: string | undefined;

  async function loadTasks(): Promise<StatusPanelTaskRecord[]> {
    const ids = Array.from(deps.roomTasks.get(deps.roomId) ?? []);
    const records: StatusPanelTaskRecord[] = [];
    for (const id of ids) {
      try {
        const r = await deps.taskBridge.show(id);
        records.push(r);
      } catch {
        // ignore — task record not available right now
      }
    }
    return records;
  }

  async function refresh(): Promise<void> {
    const tasks = await loadTasks();
    if (tasks.length === 0) return;
    const body = render(tasks);
    if (!eventId) {
      const sent = await deps.matrix.sendText(deps.roomId, body);
      eventId = sent.eventId;
    } else {
      await deps.matrix.edit(deps.roomId, eventId, body);
    }
  }

  return {
    handleTick: refresh,
    panelEventId: () => eventId,
  };
}