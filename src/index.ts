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
        const { receipt, placeholder } = await dispatchBridge.dispatch(decision.args);
        const sent = await matrix.sendText(input.roomId, placeholder);
        registry.upsertPlaceholder(threadKey, input.roomId, sent.eventId, receipt.task_id);
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
        let lastSince = 0;
        const timer = setInterval(() => {
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
        return () => {
          clearInterval(timer);
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