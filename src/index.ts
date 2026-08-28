/**
 * dsh-matrix-connector — Cordis plugin entry.
 *
 * v0.1.1 scope (deployed after upstream PR feat/v01-matrix-entry-facade,
 * commit c0b46a6):
 *   - matrix room → /agora slash command parser
 *   - agora central REST bridge for citizen / task / brain / artifact
 *   - opaque threadKey ↔ matrix room placeholder registry (plugin-internal only)
 *   - placeholder edits driven by polling GET /api/events
 *
 * §1 boundary: this plugin is the ONLY module that knows both matrix room_id
 * and agora threadKey. agora central sees opaque threadKey; matrix sees
 * opaque eventId. Neither leaks.
 */

import type { MatrixConnectorConfig } from './config.js';
import { buildConfig } from './config.js';
import { AgoraRestClient, type AgoraEvent } from './agora-rest.js';
import {
  ArtifactBridge,
  AttentionBridge,
  CitizenBridge,
  DispatchBridge,
  TaskBridge,
} from './bridges.js';
import { MatrixClient } from './matrix-client.js';
import { HELP_TEXT, renderError, route } from './message-router.js';
import { ThreadRegistry, buildThreadKey } from './thread-registry.js';
import { buildPostMortem } from './post-mortem.js';
import { buildStatusPanel } from './status-panel.js';

export interface CordisContext {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  effect: (fn: (dispose: () => void) => void) => void;
  logger: (...args: unknown[]) => void;
}

export interface CordisPlugin {
  apply: (ctx: CordisContext) => void | Promise<void>;
}

export interface PluginOptions {
  config: MatrixConnectorConfig;
  matrixClient: MatrixClient;
  agora: AgoraRestClient;
  context: CordisContext;
}

export function createMatrixConnectorPlugin(opts: PluginOptions): CordisPlugin {
  const config = buildConfig(opts.config);
  const matrix = opts.matrixClient;
  const agora = opts.agora;
  const registry = new ThreadRegistry();

  const citizenBridge = new CitizenBridge(agora);
  const dispatchBridge = new DispatchBridge(agora, {
    projectId: config.nodeId,
    defaultTemplate: 'quick',
    defaultCreator: config.userId,
  });
  const taskBridge = new TaskBridge(agora);
  const artifactBridge = new ArtifactBridge(agora);
  const attentionBridge = new AttentionBridge(agora);

  // v0.3.1 — war-room post-mortem: for each SSE tick on a known task,
  // pulls the task record and posts a one-shot summary back to the room
  // once a subtask completes or produces output.
  const postedPostMortem = new Set<string>();
  const postMortem = buildPostMortem({
    matrix,
    taskBridge: {
      show: async (taskId) => {
        // TaskBridge.show() formats markdown for IM rendering; the
        // post-mortem needs the raw TaskRecord. We bypass TaskBridge
        // and call agora.getTask() directly, then add an empty
        // subtasks[] if the server didn't include them (the smoke
        // response shape omits subtasks).
        const raw = await agora.getTask(taskId) as unknown as Record<string, unknown>;
        const team = (raw.team as { members: Array<{ role: string; agentId: string }> }) ?? { members: [] };
        return {
          id: String(raw.id ?? taskId),
          state: String(raw.state ?? 'unknown'),
          team,
          subtasks: Array.isArray(raw.subtasks) ? raw.subtasks as Array<{ status: string; output?: string | null; done_at?: string | null }> : [],
          artifacts: Array.isArray(raw.artifacts) ? raw.artifacts as Array<{ artifact_id?: string; name?: string }> : [],
        };
      },
    },
    roomForTask: (taskId) => registry.resolveTaskId(taskId)?.roomId,
    posted: postedPostMortem,
  });

  // v0.3.3 — per-room status panel. Each room gets a panel that is
  // created on the first SSE tick and edited on subsequent ticks.
  // Panel refresh is invoked after the post-mortem so the panel and
  // the summary can coexist for the same tick.
  const roomTasks = new Map<string, Set<string>>();
  function rememberTask(roomId: string, taskId: string): void {
    const set = roomTasks.get(roomId) ?? new Set<string>();
    set.add(taskId);
    roomTasks.set(roomId, set);
  }
  function panelFor(roomId: string) {
    return buildStatusPanel({
      matrix,
      taskBridge: {
        async show(taskId) {
          const raw = await agora.getTask(taskId) as unknown as Record<string, unknown>;
          return {
            id: String(raw.id ?? taskId),
            state: String(raw.state ?? 'unknown'),
            team: (raw.team as { members: Array<{ role: string; agentId: string }> }) ?? { members: [] },
            current_stage: typeof raw.current_stage === 'string' ? raw.current_stage : null,
          };
        },
      },
      roomTasks,
      roomId,
    });
  }

  async function handleRoomMessage(input: {
    roomId: string;
    senderMxid: string;
    body: string;
  }): Promise<void> {
    const decision = route(input.body, { commandName: config.commandName });
    if (decision.verb === 'unknown' || decision.verb === 'help') {
      const reply = decision.verb === 'help' ? HELP_TEXT : renderError(decision, config.commandName);
      await matrix.sendText(input.roomId, reply);
      return;
    }
    if (decision.errorCode) {
      await matrix.sendText(input.roomId, renderError(decision, config.commandName));
      return;
    }

    const projectId = config.nodeId;
    switch (decision.verb) {
      case 'citizen': {
        if (decision.subVerb === 'show') {
          const reply = await citizenBridge.show(decision.args[0]!);
          await matrix.sendText(input.roomId, reply);
          return;
        }
        const reply = await citizenBridge.list(projectId);
        await matrix.sendText(input.roomId, reply);
        return;
      }
      case 'dispatch': {
        const threadKey = buildThreadKey(input.roomId);
        // v0.3.2 — if the parseDispatchArgs() caller did not yield a
        // citizen_id (e.g. user typed `/agora dispatch <bare-name>` in a
        // room full of dsh-bridge-<name> bots), resolve against the
        // room roster as a last-chance fallback.
        const roster = await matrix.joinedMembers(input.roomId);
        const { receipt, placeholder } = await dispatchBridge.dispatch(decision.args, roster);
        const sent = await matrix.sendText(input.roomId, placeholder);
        registry.upsertPlaceholder(threadKey, input.roomId, sent.eventId, receipt.task_id);
        // v0.3.3 — register the task in this room's panel set so the
        // status panel can pick it up on the next SSE tick.
        rememberTask(input.roomId, receipt.task_id);
        return;
      }
      case 'task': {
        const taskId = decision.args[0]!;
        const includeArtifacts = decision.args.includes('artifacts');
        const head = await taskBridge.show(taskId);
        if (includeArtifacts) {
          const tail = await taskBridge.listArtifactsFor(taskId);
          await matrix.sendText(input.roomId, `${head}\n${tail}`);
        } else {
          await matrix.sendText(input.roomId, head);
        }
        return;
      }
      case 'artifact': {
        const c = await artifactBridge.fetchBytes(decision.args[0]!);
        const upload = await matrix.uploadMxc(c.name, c.mediaType, c.bytes);
        await matrix.sendText(input.roomId, `uploaded: ${upload.mxcUri} (${upload.sizeBytes} bytes)`);
        return;
      }
      case 'brain': {
        const reply = await attentionBridge.search(projectId, decision.args.join(' '));
        await matrix.sendText(input.roomId, reply);
        return;
      }
      case 'im': {
        if (decision.subVerb === 'health') {
          const h = await agora.health();
          await matrix.sendText(input.roomId, `health: ${h.status}`);
          return;
        }
        await matrix.sendText(input.roomId, HELP_TEXT);
        return;
      }
    }
  }

  async function handleAgoraEvent(evt: AgoraEvent): Promise<void> {
    const taskId = typeof evt.task_id === 'string' ? evt.task_id : undefined;
    if (!taskId) {
      return;
    }
    const binding = registry.resolveTaskId(taskId);
    if (!binding || !binding.placeholderEventId) {
      return;
    }
    const status = typeof evt.state === 'string' ? evt.state : 'running';
    const label = `🤖 ${status} (task_id=${taskId})`;
    await matrix.edit(binding.roomId, binding.placeholderEventId, label);
    // v0.3.1 — also try to post the war-room post-mortem summary if
    // the task has a subtask with output (see post-mortem.ts).
    await postMortem.handleTick(evt);
    // v0.3.3 — refresh the per-room status panel.
    await panelFor(binding.roomId).handleTick(taskId);
  }

  return {
    apply(ctx) {
      ctx.on('matrix.room.message', ((msg: unknown) => {
        void handleRoomMessage(msg as { roomId: string; senderMxid: string; body: string });
      }) as (...args: unknown[]) => void);

      ctx.on('agora.events.tick', ((evt: unknown) => {
        void handleAgoraEvent(evt as AgoraEvent);
      }) as (...args: unknown[]) => void);

      ctx.effect((_dispose) => {
        matrix.startSync();

        // v0.2 — subscribe to the agora central SSE stream. Falls back to
        // polling only if the stream fails to open (e.g. older central).
        let lastSince = 0;
        let stopped = false;
        let streamController: AbortController | null = null;
        let fallbackTimer: ReturnType<typeof setInterval> | null = null;

        const startStream = (): void => {
          if (stopped) return;
          streamController = new AbortController();
          void agora
            .streamEvents(lastSince, streamController.signal)
            .then(async (response) => {
              if (!response.ok || !response.body) {
                throw new Error(`SSE open failed: HTTP ${response.status}`);
              }
              ctx.logger('events stream opened');
              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              let buffer = '';
              while (!stopped) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let sep: number;
                while ((sep = buffer.indexOf('\n\n')) !== -1) {
                  const frame = buffer.slice(0, sep);
                  buffer = buffer.slice(sep + 2);
                  const lines = frame.split('\n');
                  let eventName = 'message';
                  let dataLines: string[] = [];
                  for (const line of lines) {
                    if (line.startsWith('event:')) eventName = line.slice(6).trim();
                    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
                  }
                  if (eventName !== 'tick' || dataLines.length === 0) continue;
                  try {
                    const parsed = JSON.parse(dataLines.join('\n')) as AgoraEvent;
                    lastSince = Math.max(lastSince, parsed.seq);
                    void handleAgoraEvent(parsed);
                  } catch (err) {
                    ctx.logger('SSE parse error:', err);
                  }
                }
              }
              ctx.logger('events stream closed; restarting');
              if (!stopped) startStream();
            })
            .catch((err: unknown) => {
              if (stopped) return;
              ctx.logger('SSE stream error; falling back to polling:', err);
              startPolling();
            });
        };

        const startPolling = (): void => {
          if (stopped || fallbackTimer !== null) return;
          fallbackTimer = setInterval(() => {
            void agora
              .pollEvents(lastSince)
              .then((page) => {
                lastSince = page.nextSince;
                for (const evt of page.events) {
                  void handleAgoraEvent(evt);
                }
              })
              .catch((err: unknown) => {
                ctx.logger('agora poll failed:', err);
              });
          }, config.eventPollIntervalMs);
        };

        startStream();

        return () => {
          stopped = true;
          streamController?.abort();
          if (fallbackTimer !== null) clearInterval(fallbackTimer);
          void matrix.stopSync();
        };
      });
    },
  };
}

// Re-exports for downstream tests / downstream plugin consumers.
export { AgoraRestClient } from './agora-rest.js';
export { MatrixClient } from './matrix-client.js';
export { type ThreadBinding, ThreadRegistry, buildThreadKey } from './thread-registry.js';
export { CitizenBridge, DispatchBridge, TaskBridge, ArtifactBridge, AttentionBridge } from './bridges.js';
export { type MatrixConnectorConfig, buildConfig } from './config.js';
export { type VerbDecision, type VerbName, route, renderError, HELP_TEXT } from './message-router.js';