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
  type CommitmentRecord,
  type CitizenRecord,
  type CreateTaskInput,
  type CreateTaskResponse,
  type ExecutiveAssistantResult,
  type ExecutiveRequestRecord,
  type ExecutiveRequestStatus,
  type OrganizationSnapshot,
  type ProjectContextRetrieveResponse,
  type TaskRecord,
} from './agora-rest.js';
import type { ProjectId } from './config.js';
import { parseDispatchArgs } from './dispatch-args.js';
import { resolveFromRoster } from './room-roster.js';

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

  async dispatch(
    args: string[],
    roster: string[] = [],
  ): Promise<{ receipt: DispatchReceipt; placeholder: string }> {
    const parsed = parseDispatchArgs(args);
    // v0.3.2 — if parseDispatchArgs did not pick a citizen_id but the
    // user typed a bare-name in a war-room full of dsh-bridge-<name>
    // bots, try the room roster as a fallback. If the roster resolves
    // it, set citizen_id so the team_override path runs below.
    let citizenId = parsed.citizen_id;
    if (!citizenId && roster.length > 0 && args.length > 0) {
      const head = args[0]!;
      // Only attempt roster resolution when the head token looks like
      // a bare name (not the v0.2b case-2 rule, which already covered
      // any <bare-word> + <rest> pattern). Roster resolution is
      // strictly opt-in via a preceding underscore-free candidate;
      // we don't re-resolve here if case-2 already fired.
      const fromRoster = resolveFromRoster(head, roster);
      if (fromRoster) citizenId = fromRoster;
    }
    const template = this.opts.defaultTemplate ?? 'quick';
    const input: CreateTaskInput = {
      title: parsed.prompt.length > 80 ? `${parsed.prompt.slice(0, 77)}...` : parsed.prompt,
      type: template,
      creator: this.opts.defaultCreator,
      description: parsed.prompt,
      priority: 'normal',
    };
    if (citizenId) {
      input.team_override = {
        members: [
          {
            role: 'executor',
            agentId: citizenId,
            member_kind: 'citizen',
            model_preference: '',
          },
        ],
      };
    }
    const response: CreateTaskResponse = await this.agora.createTask(input);
    const receipt: DispatchReceipt = {
      task_id: response.id,
      state: response.state,
    };
    const target = citizenId ? ` → @${citizenId}` : '';
    const placeholder = `🤖 thinking...${target} (task_id=${receipt.task_id})`;
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
    const artifacts = await this.agora.listArtifacts('task', detail.id);
    if (artifacts.length === 0) {
      return `task \`${detail.id}\` has no artifacts yet.`;
    }
    const body = artifacts
      .map(a => `- \`${a.id}\`  ${a.name} (${a.media_type}, ${a.size_bytes} bytes)`)
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

export interface CompanyBridgeOptions {
  defaultOrganization?: string;
}

export class CompanyBridge {
  constructor(
    private readonly agora: AgoraRestClient,
    private readonly opts: CompanyBridgeOptions = {},
  ) {}

  async list(): Promise<string> {
    const organizations = await this.agora.listOrganizations();
    if (organizations.length === 0) return 'No organizations configured in Core.';
    const lines = organizations.map((organization) =>
      `- **${organization.name}** (\`${organization.slug}\`, ${organization.status}) — ${organization.informationDomain}`,
    );
    return `Organizations (${organizations.length}):\n${lines.join('\n')}`;
  }

  async show(organizationRef?: string): Promise<string> {
    const ref = organizationRef?.trim() || this.opts.defaultOrganization?.trim();
    if (!ref) return this.list();
    const snapshot = await this.agora.getOrganization(ref);
    return renderOrganizationSnapshot(snapshot);
  }
}

function renderOrganizationSnapshot(snapshot: OrganizationSnapshot): string {
  const { organization, units, positions, employments } = snapshot;
  const currentEmployment = new Map(
    employments
      .filter((employment) => employment.status !== 'ended')
      .map((employment) => [employment.positionId, employment]),
  );
  const lines = [
    `**${organization.name}** (\`${organization.slug}\`)`,
    `domain: ${organization.informationDomain}`,
    `purpose: ${organization.purpose ?? '—'}`,
  ];
  if (units.length === 0) return [...lines, 'units: —'].join('\n');
  lines.push('organization:');
  for (const unit of units) {
    const parent = unit.parentUnitId ? `, parent=${unit.parentUnitId}` : '';
    lines.push(`- **${unit.name}** (${unit.kind}${parent})`);
    const unitPositions = positions.filter((position) => position.unitId === unit.id);
    for (const position of unitPositions) {
      const employment = currentEmployment.get(position.id);
      const occupant = employment
        ? `${employment.employmentKind} ${employment.subjectRef} [${employment.status}]`
        : 'vacant';
      lines.push(`  - ${position.title} (\`${position.id}\`, ${position.kind}) — ${occupant}`);
    }
  }
  return lines.join('\n');
}

export interface ExecutiveAssistantBridgeOptions {
  defaultOrganization?: string;
  defaultProjectId?: string;
}

interface AssistantAskOptions {
  organizationRef?: string;
  capabilities: string[];
  taskType: string;
  priority: 'low' | 'normal' | 'high';
  dueAt?: string;
  targetPositionId?: string;
  prompt: string;
}

function optionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function normalizeDueAt(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error('--due must be an ISO datetime');
  return new Date(timestamp).toISOString();
}

function parseAssistantAsk(args: string[]): AssistantAskOptions {
  let organizationRef: string | undefined;
  const capabilities: string[] = [];
  let taskType = 'quick';
  let priority: 'low' | 'normal' | 'high' = 'normal';
  let dueAt: string | undefined;
  let targetPositionId: string | undefined;
  const prompt: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith('--')) {
      prompt.push(arg);
      continue;
    }
    const value = optionValue(args, index, arg);
    index += 1;
    if (arg === '--org') organizationRef = value;
    else if (arg === '--capability') capabilities.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
    else if (arg === '--type') taskType = value;
    else if (arg === '--priority') {
      if (!['low', 'normal', 'high'].includes(value)) throw new Error('--priority must be low, normal, or high');
      priority = value as 'low' | 'normal' | 'high';
    } else if (arg === '--due') dueAt = normalizeDueAt(value);
    else if (arg === '--target') targetPositionId = value;
    else throw new Error(`unknown assistant option: ${arg}`);
  }
  const body = prompt.join(' ').trim();
  if (!body) throw new Error('assistant ask requires a non-empty request');
  return {
    capabilities: [...new Set(capabilities)],
    taskType,
    priority,
    prompt: body,
    ...(organizationRef ? { organizationRef } : {}),
    ...(dueAt ? { dueAt } : {}),
    ...(targetPositionId ? { targetPositionId } : {}),
  };
}

function extractOrganizationOption(args: string[]): { organizationRef?: string; rest: string[] } {
  const rest: string[] = [];
  let organizationRef: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--org') {
      organizationRef = optionValue(args, index, arg);
      index += 1;
    } else {
      rest.push(arg);
    }
  }
  return { rest, ...(organizationRef ? { organizationRef } : {}) };
}

export class ExecutiveAssistantBridge {
  constructor(
    private readonly agora: AgoraRestClient,
    private readonly opts: ExecutiveAssistantBridgeOptions = {},
  ) {}

  private async organizationId(override?: string): Promise<string> {
    const ref = override?.trim() || this.opts.defaultOrganization?.trim();
    if (!ref) throw new Error('no default organization configured; pass --org <id-or-slug>');
    const snapshot = await this.agora.getOrganization(ref);
    return snapshot.organization.id;
  }

  async ask(args: string[], requestedBy: string): Promise<string> {
    const parsed = parseAssistantAsk(args);
    const organizationId = await this.organizationId(parsed.organizationRef);
    const result = await this.agora.createExecutiveRequest(organizationId, {
      requested_by: requestedBy,
      title: parsed.prompt.length > 80 ? `${parsed.prompt.slice(0, 77)}...` : parsed.prompt,
      body: parsed.prompt,
      priority: parsed.priority,
      requested_capabilities: parsed.capabilities,
      task_type: parsed.taskType,
      project_id: this.opts.defaultProjectId ?? null,
      ...(parsed.dueAt ? { due_at: parsed.dueAt } : {}),
      ...(parsed.targetPositionId ? { target_position_id: parsed.targetPositionId } : {}),
    });
    return renderExecutiveResult(result);
  }

  async inbox(args: string[]): Promise<string> {
    const parsed = extractOrganizationOption(args);
    const status = parsed.rest[0] as ExecutiveRequestStatus | undefined;
    if (status && !['received', 'triage', 'delegated', 'blocked', 'completed', 'cancelled'].includes(status)) {
      throw new Error(`invalid assistant request status: ${status}`);
    }
    const organizationId = await this.organizationId(parsed.organizationRef);
    const requests = await this.agora.listExecutiveInbox(organizationId, status);
    if (requests.length === 0) return 'Assistant inbox is empty.';
    return `Assistant inbox (${requests.length}):\n${requests.map(renderExecutiveRequestLine).join('\n')}`;
  }

  async commitments(args: string[]): Promise<string> {
    const parsed = extractOrganizationOption(args);
    if (parsed.rest.length > 0) throw new Error('assistant commitments accepts only --org <id-or-slug>');
    const organizationId = await this.organizationId(parsed.organizationRef);
    const commitments = await this.agora.listCommitments(organizationId);
    if (commitments.length === 0) return 'Commitment ledger is empty.';
    return `Commitments (${commitments.length}):\n${commitments.map(renderCommitmentLine).join('\n')}`;
  }

  async show(args: string[]): Promise<string> {
    const parsed = extractOrganizationOption(args);
    const requestId = parsed.rest[0];
    if (!requestId) throw new Error('assistant show requires a request id');
    const organizationId = await this.organizationId(parsed.organizationRef);
    const request = await this.agora.getExecutiveRequest(organizationId, requestId);
    return renderExecutiveRequest(request);
  }

  async reconcile(args: string[]): Promise<string> {
    const parsed = extractOrganizationOption(args);
    const requestId = parsed.rest[0];
    if (!requestId) throw new Error('assistant reconcile requires a request id');
    const organizationId = await this.organizationId(parsed.organizationRef);
    const result = await this.agora.reconcileExecutiveRequest(organizationId, requestId, parsed.rest.slice(1));
    return renderExecutiveResult(result);
  }
}

function renderExecutiveResult(result: ExecutiveAssistantResult): string {
  const request = result.request;
  const lines = [
    `Assistant request \`${request.id}\` — ${request.status}`,
    `task: ${request.taskId ? `\`${request.taskId}\`` : '—'}`,
    `position: ${request.assignedPositionId ? `\`${request.assignedPositionId}\`` : '—'}`,
    `commitment: ${result.commitment ? `\`${result.commitment.id}\` (${result.commitment.status})` : '—'}`,
  ];
  if (request.blockedReason) lines.push(`blocked: ${request.blockedReason}`);
  return lines.join('\n');
}

function renderExecutiveRequestLine(request: ExecutiveRequestRecord): string {
  return `- \`${request.id}\` [${request.status}/${request.priority}] ${request.title} — task=${request.taskId ?? '—'}`;
}

function renderCommitmentLine(commitment: CommitmentRecord): string {
  return `- \`${commitment.id}\` [${commitment.status}] ${commitment.summary} — task=${commitment.taskId}`;
}

function renderExecutiveRequest(request: ExecutiveRequestRecord): string {
  return [
    `Assistant request \`${request.id}\` — ${request.status}`,
    `title: ${request.title}`,
    `priority: ${request.priority}`,
    `capabilities: ${request.requestedCapabilities.length > 0 ? request.requestedCapabilities.join(', ') : '—'}`,
    `task: ${request.taskId ?? '—'}`,
    `blocked: ${request.blockedReason ?? '—'}`,
  ].join('\n');
}
