/**
 * bridges — the thin agora-rest wrappers used by message-router decisions.
 *
 * Each bridge returns a string ready to render into a matrix room.
 * No business state is held here; cross-task state lives in the Cordis
 * plugin apply() scope (see index.ts).
 *
 * v0.1 reality (probe 2026-08-28, agora central v0.6.0):
 *   - createTask accepts {title, type, creator, description, priority}.
 *     The v0.1-ideal `target` / `prompt` / `actor` / `threadKey` shape was
 *     speculative and is NOT accepted by agora central. ThreadKey is a
 *     plugin-internal opaque identifier and never crosses the wire.
 *   - listCitizens / getCitizen / pollEvents throw EndpointNotDeployedError;
 *     these endpoints are merged upstream (PR feat/v01-matrix-entry-facade)
 *     but not yet deployed on the running server.
 */

import {
  AgoraRestClient,
  type CitizenRecord,
  type CreateTaskInput,
  type CreateTaskResponse,
  type ProjectContextRetrieveResponse,
  type TaskRecord,
} from './agora-rest.js';
import type { ProjectId } from './config.js';

export class CitizenBridge {
  constructor(private readonly agora: AgoraRestClient) {}

  async list(projectId: ProjectId): Promise<string> {
    const citizens: CitizenRecord[] = await this.agora.listCitizens(projectId);
    if (citizens.length === 0) {
      return 'No citizens visible in this project.';
    }
    const lines = citizens.map(
      (c) => `- \`${c.citizen_id}\`  **${c.display_name}**  (${c.role_id}, ${c.status})`,
    );
    return `Citizens (${citizens.length}):\n${lines.join('\n')}`;
  }

  async show(citizenId: string): Promise<string> {
    const c: CitizenRecord = await this.agora.getCitizen(citizenId);
    return [
      `**${c.display_name}** (\`${c.citizen_id}\`)`,
      `role: ${c.role_id}`,
      `status: ${c.status}`,
      `persona: ${c.persona ?? '—'}`,
      `boundaries: ${c.boundaries.length === 0 ? '—' : c.boundaries.join(', ')}`,
      `skills_ref: ${c.skills_ref.length === 0 ? '—' : c.skills_ref.join(', ')}`,
      `runtime_projection: ${c.runtime_projection.adapter}`,
    ].join('\n');
  }
}

export interface DispatchBridgeOptions {
  projectId: ProjectId;
  /** Template id used when the user does not specify one (defaults to 'quick'). */
  defaultTemplate?: string;
  /** MXID stamped as task creator in the agora-central record. */
  defaultCreator: string;
}

export interface DispatchReceipt {
  task_id: string;
  state: string;
}

export class DispatchBridge {
  constructor(
    private readonly agora: AgoraRestClient,
    private readonly opts: DispatchBridgeOptions,
  ) {}

  async dispatch(args: string[]): Promise<{ receipt: DispatchReceipt; placeholder: string }> {
    if (args.length === 0) {
      throw new Error('dispatch requires a non-empty prompt');
    }
    const template = this.opts.defaultTemplate ?? 'quick';
    const prompt = args.join(' ');
    const input: CreateTaskInput = {
      title: prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt,
      type: template,
      creator: this.opts.defaultCreator,
      description: prompt,
      priority: 'normal',
    };
    const response: CreateTaskResponse = await this.agora.createTask(input);
    const receipt: DispatchReceipt = {
      task_id: response.id,
      state: response.state,
    };
    const placeholder = `🤖 thinking... (task_id=${receipt.task_id})`;
    return { receipt, placeholder };
  }
}

export class TaskBridge {
  constructor(private readonly agora: AgoraRestClient) {}

  async show(taskId: string): Promise<string> {
    const detail: TaskRecord = await this.agora.getTask(taskId);
    const head = [
      `task \`${detail.id}\`  status=${detail.state}${detail.current_stage ? `  stage=${detail.current_stage}` : ''}`,
      `creator: ${detail.creator ?? '—'}`,
      `type: ${detail.type ?? '—'}`,
    ];
    return head.join('\n');
  }

  async listArtifactsFor(taskId: string): Promise<string> {
    const detail: TaskRecord = await this.agora.getTask(taskId);
    const artifacts = detail['artifacts'];
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      return `task \`${detail.id}\` has no artifacts yet.`;
    }
    const body = artifacts
      .map((a: { artifact_id?: string; name?: string; media_type?: string; size_bytes?: number }) =>
        `- \`${a.artifact_id ?? '?'}\`  ${a.name ?? '?'} (${a.media_type ?? '?'}, ${a.size_bytes ?? '?'} bytes)`,
      )
      .join('\n');
    return `artifacts for task \`${detail.id}\`:\n${body}`;
  }
}

export class ArtifactBridge {
  constructor(private readonly agora: AgoraRestClient) {}

  async fetchBytes(artifactId: string): Promise<{ bytes: Uint8Array; mediaType: string; name: string }> {
    const c = await this.agora.getArtifactContent(artifactId);
    return { bytes: c.bytes, mediaType: c.media_type, name: c.name };
  }
}

export class AttentionBridge {
  constructor(private readonly agora: AgoraRestClient) {}

  async search(projectId: ProjectId, query: string, limit = 6): Promise<string> {
    if (query.trim().length === 0) {
      return 'brain search requires a non-empty query';
    }
    const hits: ProjectContextRetrieveResponse['results']['hits'] = await this.agora.searchBrain(
      projectId,
      query,
      limit,
    );
    if (hits.length === 0) {
      return `brain search: no matches for "${query}"`;
    }
    const body = hits
      .map((h) => `- [${h.score.toFixed(2)}] \`${h.kind}:${h.slug}\`\n  ${h.excerpt}`)
      .join('\n');
    return `brain search top ${hits.length} for "${query}":\n${body}`;
  }
}