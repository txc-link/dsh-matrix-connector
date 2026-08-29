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
import { createBotTransport } from './transport/index.js';
import { MatrixJsSdkSpaceTransport } from './transport/space-transport.js';
import { MatrixSpaceAdapter, type SpaceEvent } from './space-adapter.js';
import { HELP_TEXT, renderError, route } from './message-router.js';
import { ThreadRegistry, buildThreadKey } from './thread-registry.js';
import { buildPostMortem } from './post-mortem.js';
import { buildStatusPanel } from './status-panel.js';
import { renderRollup } from './rollup.js';
import { buildStuckAlert } from './stuck-alert.js';
import { renderStuckList } from './stuck-list.js';
import { ingestMatrixReply } from './reply-ingest.js';
import type { MatrixTimelineEvent } from './matrix-client.js';

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
  /**
   * v0.6 — R-E.2: optional matrix-js-sdk raw transport. When provided
   * alongside `config.spaces.enabled === true`, the composition root
   * mounts the Space adapter and wires child timeline forwarding into
   * the existing reply-ingest path. Stub callers (unit tests) omit this
   * field; their stub transport has no SDK client and the Space mount
   * is silently skipped.
   */
  matrixJsSdkTransport?: import('./transport/matrix-js-sdk.js').MatrixJsSdkTransport;
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
    artifactLoader: async (artifactId) => {
      // v1.0.2 — fetch the artifact body via the existing
      // ArtifactBridge and return the decoded UTF-8 string. We don't
      // bound the size here; the renderer truncates to 240 chars.
      try {
        const c = await artifactBridge.fetchBytes(artifactId);
        return new TextDecoder().decode(c.bytes);
      } catch {
        return undefined;
      }
    },
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

  // v2.0.1 — stuck alert. Subscribes to inbox_escalated events from
  // the background observation scheduler and posts a one-shot
  // summary to the originating room. The plugin does NOT
  // auto-reassign; that would require a Core endpoint we do not have.
  const alertedStuck = new Set<string>();
  const stuckTasksList: Array<{ taskId: string; idleMs: number; stage: string; agentId: string; roomId: string }> = [];
  const stuckAlert = buildStuckAlert({
    matrix,
    taskBridge: {
      show: async (taskId) => {
        const raw = await agora.getTask(taskId) as unknown as Record<string, unknown>;
        return {
          id: String(raw.id ?? taskId),
          state: String(raw.state ?? 'unknown'),
          current_stage: typeof raw.current_stage === 'string' ? raw.current_stage : null,
          creator: typeof raw.creator === 'string' ? raw.creator : undefined,
          team: (raw.team as { members: Array<{ role: string; agentId: string }> }) ?? { members: [] },
          subtasks: Array.isArray(raw.subtasks) ? raw.subtasks as Array<{ status: string }> : [],
        };
      },
    },
    roomForTask: (taskId) => registry.resolveTaskId(taskId)?.roomId,
    alerted: alertedStuck,
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
    // v1.0.1 — every incoming room message remembers the room for
    // the org rollup view.
    registry.rememberRoom(input.roomId);
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
      case 'rollup': {
        // v1.0.1 — org war-room rollup. Read-only view built from the
        // plugin's in-memory ThreadRegistry state. Does not query agora
        // central and does not change any task lifecycle.
        const reply = renderRollup({
          rooms: registry.knownRoomIds(),
          tasks: registry.taskSummaries(),
        });
        await matrix.sendText(input.roomId, reply);
        return;
      }
      case 'stuck': {
        // v2.0.2 — list tasks the plugin has observed stuck in this
        // session (via SSE inbox_escalated). Session-local data; a
        // fresh restart rebuilds the list from SSE replay.
        const reply = renderStuckList({
          stuckTasks: stuckTasksList,
          rooms: new Set([input.roomId]),
        });
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
    // v1.0.1 — update the in-memory task summary used by /agora rollup.
    const agent = typeof evt.actor === 'string' && evt.actor.length > 0 ? evt.actor : 'unknown';
    registry.rememberTask(taskId, binding.roomId, status, agent);
    // v2.0.1 — react to inbox_escalated events from the background
    // observation scheduler by posting a one-shot stuck alert to the
    // room. The plugin does NOT auto-reassign; that would require a
    // Core endpoint we don't have today.
    await stuckAlert.handleEvent(evt as AgoraEvent);
    // v2.0.2 — also keep an in-memory list of stuck tasks so
    // /agora stuck can render them on demand.
    if ((evt as AgoraEvent).type === 'inbox_escalated') {
      const detail = (evt as { detail?: { kind?: string; idle_ms?: number } }).detail;
      const idleMs = typeof detail?.idle_ms === 'number' ? detail.idle_ms : 0;
      try {
        const raw = await agora.getTask(taskId) as unknown as Record<string, unknown>;
        const team = (raw.team as { members?: Array<{ role: string; agentId: string }> }) ?? { members: [] };
        const agent = (team.members ?? []).find((m: { role: string; agentId: string }) => m.role === 'executor')?.agentId ?? 'unknown';
        const stage = typeof raw.current_stage === 'string' ? raw.current_stage : '-';
        stuckTasksList.push({
          taskId,
          idleMs,
          stage,
          agentId: agent,
          roomId: binding.roomId,
        });
      } catch {
        /* task record unavailable — skip list update */
      }
    }
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

      // v0.5 — R-D: inbound reply wiring. Raw matrix timeline events
      // (m.room.message with m.relates_to) → ingestMatrixReply → agora
      // POST /api/tasks/:id/conversation/reply. §1: matrix protocol
      // parsing stays here (adapter side); agora Core only sees opaque
      // provider_message_ref / parent_message_ref / thread_task_binding_key.
      // v0.1.4 — timeline 分流: 回帖走 reply ingest, 普通消息走 /agora
      // slash 路由 (handleRoomMessage)。此前 handleRoomMessage 只能由
      // 'matrix.room.message' 事件触发, 而无人 emit 该事件, slash 死路。
      matrix.onTimelineEvent((evt: MatrixTimelineEvent) => {
        if (evt.type !== 'm.room.message') return;
        if (evt.isOwn) return;
        if (evt.relatesTo?.inReplyTo?.eventId) {
          void ingestMatrixReply({
            agora,
            threadKeyOf: (roomId) => registry.threadKeyFor(roomId),
            taskIdOf: (threadKey) => registry.get(threadKey)?.taskId ?? undefined,
            event: {
              roomId: evt.roomId,
              eventId: evt.eventId,
              sender: evt.sender,
              body: evt.body ?? '',
              ...(evt.relatesTo ? { relatesTo: evt.relatesTo } : {}),
            },
            occurredAt: evt.originServerTs
              ? new Date(evt.originServerTs).toISOString()
              : new Date().toISOString(),
          }).catch((err: unknown) => {
            ctx.logger('reply ingest failed:', err);
          });
          return;
        }
        void handleRoomMessage({
          roomId: evt.roomId,
          senderMxid: evt.sender,
          body: evt.body ?? '',
        }).catch((err: unknown) => {
          ctx.logger('slash command failed:', err);
        });
      });

      // v0.6 — R-E.2: opt-in Space adapter mount. The matrix-js-sdk raw
      // transport must be supplied and `config.spaces.enabled` must be
      // true; otherwise the Space surface is completely inert (preserves
      // v0.5 caller behaviour). When mounted, every Space root's child
      // timeline is folded into the existing reply-ingest path — child
      // rooms with a thread binding receive their m.room.message events
      // exactly like a top-level room. §1 boundary: matrix protocol
      // (`m.space.child` state, `Room.isSpaceRoom`) stays in the adapter;
      // agora Core sees opaque threadKey.
      const spacesConfig = opts.config.spaces;
      const matrixJsSdkTransport = opts.matrixJsSdkTransport;
      if (spacesConfig?.enabled === true && matrixJsSdkTransport) {
        const spaceTransport = new MatrixJsSdkSpaceTransport({ matrixJsSdkTransport });
        const spaceAdapter = new MatrixSpaceAdapter(spaceTransport);
        const rootSpaces = Array.isArray(spacesConfig.rootSpaces) ? spacesConfig.rootSpaces : [];
        const spaceDisposers: Array<() => void> = [];
        for (const rootSpaceId of rootSpaces) {
          if (typeof rootSpaceId !== 'string' || rootSpaceId.length === 0) continue;
          const dispose = spaceAdapter.subscribeSpaceEvents(
            rootSpaceId,
            (evt: SpaceEvent) => {
              if (evt.kind !== 'message') {
                ctx.logger(`[space ${rootSpaceId}] ${evt.kind}`);
                return;
              }
              // Forward child timeline messages through the same
              // reply-ingest path R-D set up. The child room may have its
              // own thread binding via the parent space's task — but we
              // do not auto-create one; if no binding exists,
              // ingestMatrixReply returns 'skipped'.
              void ingestMatrixReply({
                agora,
                threadKeyOf: (roomId) => registry.threadKeyFor(roomId),
                taskIdOf: (threadKey) => registry.get(threadKey)?.taskId ?? undefined,
                event: {
                  roomId: evt.childRoomId,
                  eventId: evt.eventId,
                  sender: evt.sender,
                  body: evt.body,
                },
                occurredAt: new Date().toISOString(),
              }).catch((err: unknown) => {
                ctx.logger('space reply ingest failed:', err);
              });
            },
          );
          spaceDisposers.push(dispose);
        }
        ctx.effect(() => {
          return () => {
            for (const dispose of spaceDisposers) dispose();
          };
        });
      }

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
export type {
  MatrixRoomMessage,
  MatrixSendReceipt,
  MatrixEditReceipt,
  MatrixUploadReceipt,
  MatrixTransport,
  MatrixRoomCreator,
  CreateRoomArgs,
} from './matrix-client.js';
export {
  MatrixJsSdkTransport,
  createBotTransport,
  createAppServiceTransport,
  type BotTransportOptions,
  type AppServiceTransportOptions,
  type CreateRoomOptions,
  type CreateRoomReceipt,
} from './transport/index.js';
export { MatrixJsSdkSpaceTransport, type MatrixJsSdkSpaceTransportOptions } from './transport/space-transport.js';
export { MatrixSpaceAdapter, DEFAULT_SPACE_CONFIG, type SpaceChild, type SpaceRef, type SpaceEvent, type SpaceEventHandler, type SpaceConfig, type MatrixSpaceTransport } from './space-adapter.js';
export { type ThreadBinding, ThreadRegistry, buildThreadKey } from './thread-registry.js';
export { CitizenBridge, DispatchBridge, TaskBridge, ArtifactBridge, AttentionBridge } from './bridges.js';
export { type MatrixConnectorConfig, buildConfig } from './config.js';
export { type VerbDecision, type VerbName, route, renderError, HELP_TEXT } from './message-router.js';export { buildRoomName, ROOM_NAME_MAX_LENGTH, UNTITLED_FALLBACK } from './room-name.js';
export { provisionTaskRoom } from './room-provisioner.js';
export type {
  RoomProvisionerClient,
  RoomProvisionerAgora,
  ProvisionTaskRoomOptions,
  ProvisionTaskRoomResult,
} from './room-provisioner.js';
export { ingestMatrixReply, type MatrixReplyEvent, type IngestMatrixReplyOptions } from './reply-ingest.js';

// ── Cordis 顶层入口 ─────────────────────────────────────────────────────
// npm 直装时 loader 约定: 模块顶层必须导出 { apply, name, inject }。
// 工厂 createMatrixConnectorPlugin() 保留给测试与编程式组装；这里负责
// 从 profile row 的扁平 config 构建 transport/client 并接线。
export const name = 'dsh-matrix-connector';
export const inject: string[] = [];

export async function apply(ctx: CordisContext, config?: Partial<MatrixConnectorConfig>): Promise<void> {
  const input = (config ?? {}) as Partial<MatrixConnectorConfig>;
  const required = ['homeserverUrl', 'userId', 'accessToken', 'deviceId', 'agoraServerUrl', 'agoraApiToken'] as const;
  for (const field of required) {
    if (!input[field]) throw new Error(`dsh-matrix-connector: missing required config field '${field}' (check the matrix-connector row in cordis.patch.yml)`);
  }
  const resolved = buildConfig(input as MatrixConnectorConfig);
  const transport = createBotTransport({
    homeserverUrl: resolved.homeserverUrl,
    userId: resolved.userId,
    accessToken: resolved.accessToken,
    deviceId: resolved.deviceId,
  });
  const matrix = new MatrixClient(transport);
  // v0.1.4 — autoJoin: accept pending room invites (register before
  // connect so invites delivered by the initial sync are handled).
  if (resolved.autoJoin) {
    matrix.onRoomInvite((roomId: string) => {
      void matrix.joinRoom(roomId).catch((err: unknown) => {
        ctx.logger('autoJoin failed for room:', roomId, err);
      });
    });
  }
  // v0.1.4 — the bot cannot receive anything until the transport starts
  // its /sync loop. Previously the connector built the transport and
  // never called connect(): all timeline wiring was dead code.
  await transport.connect();
  const agora = new AgoraRestClient({
    baseUrl: resolved.agoraServerUrl,
    apiToken: resolved.agoraApiToken,
  });
  const plugin = createMatrixConnectorPlugin({
    config: resolved,
    matrixClient: matrix,
    agora,
    context: ctx,
  });
  await plugin.apply(ctx);
  ctx.effect(() => {
    void transport.stopSync().catch((err: unknown) => {
      ctx.logger('matrix transport stopSync failed:', err);
    });
  });
}
