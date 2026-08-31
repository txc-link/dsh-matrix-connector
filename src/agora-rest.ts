/**
 * agora-rest — minimal typed fetch client for the Agora central REST surface
 * exercised by the v0.1 dsh-matrix-connector.
 *
 * Endpoints verified against agora central v0.6.0 at turn 33 (probe results
 * captured in progress.md). Endpoints marked with `[NOT DEPLOYED]` are part
 * of the v0.1 scope but were not present in the deployed server at the time
 * of v0.1 close; they are part of the merged upstream PR
 * `feat/v01-matrix-entry-facade` (commit c0b46a6 on master) and will become
 * available once that PR is built, deployed, and the agora central server
 * is restarted.
 *
 * VERIFIED ENDPOINTS (probe 2026-08-28, server v0.6.0):
 *   GET  /api/health                          -> { status: 'ok' }
 *   GET  /api/templates                       -> Template[]
 *   POST /api/tasks                           -> { id, ... }
 *   GET  /api/tasks                           -> TaskRecord[]
 *   GET  /api/tasks/:id                       -> TaskRecord
 *   GET  /api/projects                        -> { projects: ProjectRecord[] }
 *   GET  /api/projects/:id                    -> ProjectRecord (includes nested citizens)
 *   GET  /api/projects/:id/context/retrieve   -> ProjectContextRetrieveResponse
 *   GET  /api/projects/:id/members            -> { memberships: ProjectMembership[] }
 *   GET  /api/artifacts                       -> { artifacts: ArtifactRecord[] }
 *   GET  /api/artifacts/:id                   -> ArtifactRecord
 *   GET  /api/artifacts/:id/content           -> raw bytes
 *   GET  /api/skills                          -> { skills: Skill[] }
 *   GET  /api/inbox                           -> InboxEntry[]
 *
 * DEPLOYED-BUT-NOT-IN-CORE-CONTRACT (not exposed in v0.1 connector yet):
 *   GET  /api/citizens?project_id=...         [NOT DEPLOYED in v0.6.0]
 *   GET  /api/citizens/:id                    [NOT DEPLOYED in v0.6.0]
 *   GET  /api/events?task_id=...&since=...    [NOT DEPLOYED in v0.6.0]
 *
 * Per §1.5 of the Agora constitution, this module does NOT pretend an
 * endpoint works when it does not. Methods that depend on a missing
 * endpoint raise a clearly-named `EndpointNotDeployedError` instead of
 * returning an empty result silently.
 */

import type { ProjectId } from './config.js';

export interface AgoraFetchOptions {
  baseUrl: string;
  apiToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface HealthResponse {
  status: 'ok' | string;
}

export interface TemplateRecord {
  id: string;
  name: string;
  type: string;
  description: string;
  governance: string;
  stage_count: number;
}

/**
 * POST /api/tasks request body. Field names match the v0.6.0 schema
 * discovered by probing at turn 31 (not the v0.1-ideal `target`/`prompt`/
 * `actor` shape — that shape was hallucinated and rejected at turn 32).
 */
export interface CreateTaskInput {
  title: string;
  type: string; // template id, e.g. 'quick', 'coding', 'brainstorm', 'research'
  creator: string; // user_id-style identifier
  description: string;
  priority: 'low' | 'normal' | 'high';
  team_override?: {
    members: Array<{
      role: string;
      agentId: string;
      member_kind?: 'controller' | 'citizen' | 'craftsman';
      model_preference: string;
      agent_origin?: 'agora_managed' | 'user_managed';
      briefing_mode?: 'overlay_full' | 'overlay_delta';
    }>;
  };
}

export interface CreateTaskResponse {
  id: string;
  title: string;
  state: string;
  type: string;
  creator: string;
  description?: string;
  priority?: string;
  project_id?: string | null;
  [k: string]: unknown;
}

export interface TaskRecord {
  id: string;
  title: string;
  state: string;
  type: string;
  creator: string;
  description?: string;
  priority?: string;
  project_id?: string | null;
  current_stage?: string | null;
  [k: string]: unknown;
}

export interface ProjectRecord {
  id: string;
  name: string;
  owner?: string | null;
  summary?: string | null;
  status?: string;
  updated_at?: string;
  [k: string]: unknown;
}

export interface ProjectContextRetrieveResponse {
  scope: string;
  mode: string;
  results: {
    hits: Array<{
      reference_key: string;
      kind: string;
      slug: string;
      score: number;
      excerpt: string;
    }>;
  };
}

export interface ArtifactRecord {
  id: string;
  name: string;
  kind: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
  owner_kind?: string;
  owner_ref?: string;
}

export interface ArtifactContent {
  artifact_id: string;
  bytes: Uint8Array;
  media_type: string;
  name: string;
}

export interface RelationshipInitiativeDeliveryRecord {
  id: string;
  profile_id: string;
  profile_version: number;
  owner_ref: string;
  agent_ref: string;
  trigger: string;
  modality: 'text' | 'voice';
  text: string;
  resource_ref: string;
  source_domain: string;
  target_domain: string;
  delivery_binding_ref: string;
  purpose: string;
  requested_fields: string[];
  lease_token: string;
}

export interface OrganizationRecord {
  id: string;
  slug: string;
  name: string;
  ownerRef: string;
  informationDomain: string;
  purpose: string | null;
  status: 'active' | 'archived';
  version: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
}

export interface OrganizationUnitRecord {
  id: string;
  organizationId: string;
  name: string;
  kind: 'executive_office' | 'department' | 'team';
  parentUnitId: string | null;
  responsibilities: string[];
  status: 'active' | 'archived';
  version: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
}

export interface PositionRecord {
  id: string;
  organizationId: string;
  unitId: string;
  title: string;
  kind: 'executive_assistant' | 'lead' | 'specialist' | 'worker' | 'auditor';
  reportsToPositionId: string | null;
  responsibilities: string[];
  skills: string[];
  status: 'active' | 'archived';
  version: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
}

export interface EmploymentRecord {
  id: string;
  organizationId: string;
  positionId: string;
  subjectKind: 'human' | 'agent';
  subjectRef: string;
  employmentKind: 'resident' | 'on_demand' | 'advisor';
  status: 'active' | 'suspended' | 'ended';
  startedAt: string;
  endedAt: string | null;
  endedReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
}

export interface OrganizationSnapshot {
  organization: OrganizationRecord;
  units: OrganizationUnitRecord[];
  positions: PositionRecord[];
  employments: EmploymentRecord[];
}

export type ExecutiveRequestStatus =
  | 'received'
  | 'triage'
  | 'delegated'
  | 'blocked'
  | 'completed'
  | 'cancelled';

export interface ExecutiveRequestRecord {
  id: string;
  organizationId: string;
  requestedBy: string;
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'high';
  requestedCapabilities: string[];
  taskType: string;
  projectId: string | null;
  dueAt: string | null;
  status: ExecutiveRequestStatus;
  assignedPositionId: string | null;
  assignedEmploymentId: string | null;
  taskId: string | null;
  blockedReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CommitmentRecord {
  id: string;
  organizationId: string;
  requestId: string;
  ownerPositionId: string;
  ownerEmploymentId: string;
  taskId: string;
  summary: string;
  dueAt: string | null;
  status: 'open' | 'fulfilled' | 'cancelled';
  evidenceRefs: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  fulfilledAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CreateExecutiveRequestInput {
  requested_by: string;
  title: string;
  body: string;
  priority?: 'low' | 'normal' | 'high';
  requested_capabilities?: string[];
  task_type?: string;
  project_id?: string | null;
  due_at?: string | null;
  target_position_id?: string | null;
}

export interface ExecutiveAssistantResult {
  ok: true;
  request: ExecutiveRequestRecord;
  commitment: CommitmentRecord | null;
}

export class AgoraRestClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AgoraFetchOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/u, '');
    this.apiToken = opts.apiToken;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'content-type': 'application/json',
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`agora ${method} ${path} failed: ${response.status} ${await response.text()}`);
      }
      // Some endpoints return raw bytes (artifacts content); handle both.
      const headers = response.headers as { get?: (k: string) => string | null } | undefined;
      const ct = headers?.get?.('content-type') ?? '';
      if (ct.includes('application/json')) {
        return (await response.json()) as T;
      }
      return (await response.text()) as unknown as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/api/health');
  }

  async listOrganizations(): Promise<OrganizationRecord[]> {
    const result = await this.request<{ organizations: OrganizationRecord[] }>('GET', '/api/organizations');
    return result.organizations;
  }

  async getOrganization(idOrSlug: string): Promise<OrganizationSnapshot> {
    return this.request<OrganizationSnapshot>(
      'GET',
      `/api/organizations/${encodeURIComponent(idOrSlug)}`,
    );
  }

  async createExecutiveRequest(
    organizationId: string,
    input: CreateExecutiveRequestInput,
  ): Promise<ExecutiveAssistantResult> {
    return this.request<ExecutiveAssistantResult>(
      'POST',
      `/api/organizations/${encodeURIComponent(organizationId)}/assistant/requests`,
      input,
    );
  }

  async listExecutiveInbox(
    organizationId: string,
    status?: ExecutiveRequestStatus,
  ): Promise<ExecutiveRequestRecord[]> {
    const query = status ? `?${new URLSearchParams({ status }).toString()}` : '';
    const result = await this.request<{ requests: ExecutiveRequestRecord[] }>(
      'GET',
      `/api/organizations/${encodeURIComponent(organizationId)}/assistant/inbox${query}`,
    );
    return result.requests;
  }

  async listCommitments(organizationId: string): Promise<CommitmentRecord[]> {
    const result = await this.request<{ commitments: CommitmentRecord[] }>(
      'GET',
      `/api/organizations/${encodeURIComponent(organizationId)}/assistant/commitments`,
    );
    return result.commitments;
  }

  async getExecutiveRequest(organizationId: string, requestId: string): Promise<ExecutiveRequestRecord> {
    return this.request<ExecutiveRequestRecord>(
      'GET',
      `/api/organizations/${encodeURIComponent(organizationId)}/assistant/requests/${encodeURIComponent(requestId)}`,
    );
  }

  async reconcileExecutiveRequest(
    organizationId: string,
    requestId: string,
    evidenceRefs: string[] = [],
  ): Promise<ExecutiveAssistantResult> {
    return this.request<ExecutiveAssistantResult>(
      'POST',
      `/api/organizations/${encodeURIComponent(organizationId)}/assistant/requests/${encodeURIComponent(requestId)}/reconcile`,
      { evidence_refs: evidenceRefs },
    );
  }

  async authorizeInformationProjection(input: {
    resource_ref: string;
    actor_ref: string;
    target_domain: string;
    purpose: string;
    permission: 'read' | 'derive' | 'disclose' | 'act';
    requested_fields: string[];
  }): Promise<{ allowed: boolean; reason: string; grant_id: string | null }> {
    return this.request('POST', '/api/governance/information/authorize', input);
  }

  async assessActionRisk(input: {
    actor_ref: string;
    subject_ref: string;
    action_kind: 'communicate';
    reversibility: 'compensatable';
    recurrence: 'one_off';
    sensitive_disclosure: boolean;
    health_impact: boolean;
    third_party_effect: boolean;
    new_counterparty: boolean;
    metadata: Record<string, unknown>;
  }): Promise<{
    id: string;
    decision: 'allow' | 'require_human_gate' | 'deny';
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    reasons: string[];
  }> {
    return this.request('POST', '/api/governance/action-risk/assess', input);
  }

  async claimRelationshipInitiatives(input: {
    consumer_ref: string;
    target_domain: string;
    limit?: number;
    lease_ms?: number;
  }): Promise<RelationshipInitiativeDeliveryRecord[]> {
    const result = await this.request<{ initiatives: RelationshipInitiativeDeliveryRecord[] }>(
      'POST', '/api/relationship-initiatives/claim', input,
    );
    return result.initiatives;
  }

  async markRelationshipInitiativeDelivered(id: string, leaseToken: string): Promise<void> {
    await this.request('POST', `/api/relationship-initiatives/${encodeURIComponent(id)}/delivered`, {
      lease_token: leaseToken,
    });
  }

  async markRelationshipInitiativeFailed(id: string, leaseToken: string, error: string): Promise<void> {
    await this.request('POST', `/api/relationship-initiatives/${encodeURIComponent(id)}/failed`, {
      lease_token: leaseToken,
      error,
    });
  }

  async listTemplates(): Promise<TemplateRecord[]> {
    return this.request<TemplateRecord[]>('GET', '/api/templates');
  }

  async listTasks(): Promise<TaskRecord[]> {
    return this.request<TaskRecord[]>('GET', '/api/tasks');
  }

  async getTask(taskId: string): Promise<TaskRecord> {
    return this.request<TaskRecord>('GET', `/api/tasks/${encodeURIComponent(taskId)}`);
  }

  async createTask(input: CreateTaskInput): Promise<CreateTaskResponse> {
    return this.request<CreateTaskResponse>('POST', '/api/tasks', input);
  }

  /**
   * v0.4.0 — task lifecycle actions. All three were verified on the
   * deployed agora central (probe 2026-08-30): POST /api/tasks/:id/pause,
   * /resume and /cancel. pause/cancel accept an optional `reason`;
   * resume takes an empty object.
   */
  async pauseTask(taskId: string, reason = ''): Promise<TaskRecord> {
    return this.request<TaskRecord>('POST', `/api/tasks/${encodeURIComponent(taskId)}/pause`, { reason });
  }

  async resumeTask(taskId: string): Promise<TaskRecord> {
    return this.request<TaskRecord>('POST', `/api/tasks/${encodeURIComponent(taskId)}/resume`, {});
  }

  async cancelTask(taskId: string, reason = ''): Promise<TaskRecord> {
    return this.request<TaskRecord>('POST', `/api/tasks/${encodeURIComponent(taskId)}/cancel`, { reason });
  }

  /**
   * v0.4.0 — unblock a blocked task. `action` is one of retry | skip |
   * reassign; `assignee`/`craftsman_type` apply to the reassign action.
   */
  async unblockTask(
    taskId: string,
    input: {
      reason?: string;
      action?: 'retry' | 'skip' | 'reassign';
      assignee?: string;
      craftsman_type?: string;
    } = {},
  ): Promise<TaskRecord> {
    return this.request<TaskRecord>('POST', `/api/tasks/${encodeURIComponent(taskId)}/unblock`, input);
  }

  /**
   * R-D — record an inbound IM reply as a task conversation entry.
   * Opaque fields only (provider_message_ref / parent_message_ref are
   * adapter-resolved event ids; thread_task_binding_key is the opaque
   * threadKey). matrix m.relates_to parsing stays in the adapter.
   */
  async recordInboundReply(
    taskId: string,
    input: {
      provider: string;
      provider_message_ref: string;
      parent_message_ref?: string;
      body: string;
      author_kind: 'human' | 'agent' | 'craftsman' | 'system';
      author_ref?: string;
      display_name?: string;
      occurred_at: string;
      thread_task_binding_key?: string;
    },
  ): Promise<{ id: string; deduped: boolean }> {
    return this.request<{ id: string; deduped: boolean }>(
      'POST',
      `/api/tasks/${encodeURIComponent(taskId)}/conversation/reply`,
      input,
    );
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const response = await this.request<{ projects: ProjectRecord[] }>('GET', '/api/projects');
    return response.projects;
  }

  async getProject(projectId: ProjectId): Promise<ProjectRecord & { citizens?: unknown[] }> {
    return this.request<ProjectRecord & { citizens?: unknown[] }>(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}`,
    );
  }

  /**
   * brain-equivalent lookup. agora central v0.6.0 exposes context/retrieve
   * (POST) rather than /api/projects/:id/brain (GET). Caller passes the
   * natural query and receives the same shape: { hits: [...] }.
   *
   * When the upstream server is older than the merged PR, this returns
   * whatever the server returns for `projectId`. In v0.6.0 the route is
   * `POST /api/projects/:id/context/retrieve`.
   */
  async searchBrain(
    projectId: ProjectId,
    query: string,
    limit = 6,
  ): Promise<ProjectContextRetrieveResponse['results']['hits']> {
    // Real endpoint is POST /api/projects/:id/context/retrieve
    const response = await this.request<ProjectContextRetrieveResponse>(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/context/retrieve`,
      { q: query, limit, mode: 'lookup' },
    );
    return response.results.hits;
  }

  async listArtifacts(ownerKind?: string, ownerRef?: string): Promise<ArtifactRecord[]> {
    const params = new URLSearchParams();
    if (ownerKind) params.set('owner_kind', ownerKind);
    if (ownerRef) params.set('owner_ref', ownerRef);
    const query = params.size > 0 ? `?${params.toString()}` : '';
    const response = await this.request<{ artifacts: ArtifactRecord[] }>('GET', `/api/artifacts${query}`);
    return response.artifacts;
  }

  async getArtifact(artifactId: string): Promise<ArtifactRecord> {
    return this.request<ArtifactRecord>('GET', `/api/artifacts/${encodeURIComponent(artifactId)}`);
  }

  async getArtifactContent(artifactId: string): Promise<ArtifactContent> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}/content`,
        {
          method: 'GET',
          headers: this.headers(),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(
          `agora GET /api/artifacts/${artifactId}/content failed: ${response.status} ${await response.text()}`,
        );
      }
      const ab = await response.arrayBuffer();
      const bytes = new Uint8Array(ab);
      const headerRecord = await this.getArtifact(artifactId).catch(() => null);
      return {
        artifact_id: artifactId,
        bytes,
        media_type: response.headers.get('content-type') ?? headerRecord?.media_type ?? 'application/octet-stream',
        name: headerRecord?.name ?? artifactId,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Endpoints added by upstream PR feat/v01-matrix-entry-facade
  // (commit c0b46a6 on master). v0.1.1 enables these after the PR is
  // deployed on agora central.
  // ─────────────────────────────────────────────────────────────────

  async listCitizens(projectId: ProjectId, status?: 'active' | 'archived'): Promise<CitizenRecord[]> {
    const qs = new URLSearchParams({ project_id: projectId });
    if (status) qs.set('status', status);
    const response = await this.request<{ citizens: CitizenRecord[] }>('GET', `/api/citizens?${qs.toString()}`);
    return response.citizens;
  }

  async getCitizen(citizenId: string): Promise<CitizenRecord> {
    return this.request<CitizenRecord>('GET', `/api/citizens/${encodeURIComponent(citizenId)}`);
  }

  /**
   * Subscribe to the agora central SSE event stream. Returns the raw
   * fetch Response so the caller can read it as a ReadableStream of
   * UTF-8 text/event-stream frames. The caller is responsible for
   * aborting the signal to close the stream.
   *
   * Returns a Response with `body` available (or null on failure).
   * The HTTP status + content-type must be checked by the caller; the
   * stream may not be open (e.g. older central without /api/events/stream).
   */
  async streamEvents(
    since: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    const init: RequestInit = { method: 'GET', headers: this.headers() };
    if (signal) init.signal = signal;
    return this.fetchImpl(
      `${this.baseUrl}/api/events/stream?since=${encodeURIComponent(String(since))}&project_id=node-a`,
      init,
    );
  }

  async pollEvents(since: number, signal?: AbortSignal): Promise<{ events: AgoraEvent[]; nextSince: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/events?since=${encodeURIComponent(String(since))}`, {
        method: 'GET',
        headers: this.headers(),
        signal: signal ?? controller.signal,
      });
      if (!response.ok) {
        throw new Error(`agora GET /api/events failed: ${response.status} ${await response.text()}`);
      }
      const body = (await response.json()) as { events: AgoraEvent[]; next_since?: number };
      const events = body.events ?? [];
      const maxSeq = events.reduce((acc, evt) => Math.max(acc, evt.seq), since);
      const nextSince = body.next_since ?? maxSeq;
      return { events, nextSince };
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface CitizenRecord {
  citizen_id: string;
  project_id: ProjectId;
  role_id: string;
  display_name: string;
  persona: string | null;
  status: 'active' | 'archived';
  boundaries: string[];
  skills_ref: string[];
  channel_policies: Record<string, unknown>;
  runtime_projection: { adapter: string; auto_provision: boolean; metadata: Record<string, unknown> };
}

export interface AgoraEvent {
  seq: number;
  type: 'task_state_changed' | 'artifact_created' | 'inbox_new' | 'coord_run_progress' | 'progress:log' | 'progress:progress' | string;
  task_id?: string;
  state?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  stage_id?: string | null;
  from_state?: string | null;
  to_state?: string | null;
  actor?: string | null;
  detail?: unknown;
  progress_content?: string | null;
  created_at?: string;
  [k: string]: unknown;
}

export interface AgoraEventPage {
  events: AgoraEvent[];
  nextSince: number;
}
