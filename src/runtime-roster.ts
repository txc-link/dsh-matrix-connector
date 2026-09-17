/**
 * Runtime roster projection for Matrix rooms.
 *
 * Agora owns node/agent assignment.  This module only turns that read-only
 * inventory into a room-friendly view so a human can answer "which role is
 * running on which machine and harness?" without opening the dashboard.
 */

import type {
  AgoraRestClient,
  RuntimeNodeRecord,
  RuntimeTargetRecord,
} from './agora-rest.js';

export interface RuntimeTeamMember {
  role?: string;
  agentId?: string;
  agent_id?: string;
}

interface RuntimeLocation {
  nodeId: string;
  agentRef: string;
  displayName: string;
  roles: string[];
  model?: string;
  harness: string;
  presence: string;
  targetRef?: string;
  runtimeFlavor?: string;
  enabled?: boolean;
  lastSeenAt?: string;
}

function text(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function harnessLabel(value: unknown): string {
  const raw = text(value, 'unknown');
  const labels: Record<string, string> = {
    'deepseek-harness': 'DeepSeek Harness',
    'claude-code': 'Claude Code',
    'codex': 'Codex',
    'hermes': 'Hermes',
    'openclaw': 'OpenClaw',
    'pi': 'Pi',
  };
  return labels[raw.toLowerCase()] ?? raw;
}

function targetParts(targetRef: string): { nodeId?: string; agentRef?: string } {
  const match = /^dsh:([^:]+):(.+)$/u.exec(targetRef.trim());
  return match && match[1] !== undefined && match[2] !== undefined
    ? { nodeId: match[1], agentRef: match[2] }
    : {};
}

function buildLocations(nodes: RuntimeNodeRecord[], targets: RuntimeTargetRecord[]): RuntimeLocation[] {
  const targetByRef = new Map(targets.map((target) => [target.runtime_target_ref, target]));
  const locations: RuntimeLocation[] = [];

  for (const node of nodes) {
    for (const agent of node.agents ?? []) {
      const ref = text(agent.agent_ref, 'default');
      const targetRef = `dsh:${node.node_id}:${ref}`;
      const target = targetByRef.get(targetRef);
      locations.push({
        nodeId: node.node_id,
        agentRef: ref,
        displayName: text(agent.display_name, ref),
        roles: Array.isArray(agent.roles) ? agent.roles.filter((role) => typeof role === 'string') : [],
        ...(agent.model ? { model: agent.model } : {}),
        harness: harnessLabel(target?.host_framework ?? node.host_framework ?? node.runtime_provider),
        presence: text(node.presence, 'unknown'),
        ...(target ? {
          targetRef: target.runtime_target_ref,
          ...(target.runtime_flavor ? { runtimeFlavor: target.runtime_flavor } : {}),
          enabled: target.enabled,
        } : {}),
        ...(node.last_seen_at ? { lastSeenAt: node.last_seen_at } : {}),
      });
    }
  }

  // A target can be registered before its node heartbeat arrives.  Keep it in
  // the view rather than silently hiding a potentially assigned role.
  for (const target of targets) {
    if (locations.some((location) => location.targetRef === target.runtime_target_ref)) continue;
    const parts = targetParts(target.runtime_target_ref);
    if (!parts.nodeId || !parts.agentRef) continue;
    locations.push({
      nodeId: parts.nodeId,
      agentRef: parts.agentRef,
      displayName: text(target.display_name, parts.agentRef),
      roles: [],
      ...(target.primary_model ? { model: target.primary_model } : {}),
      harness: harnessLabel(target.host_framework ?? target.runtime_provider),
      presence: target.enabled ? 'registered' : 'disabled',
      targetRef: target.runtime_target_ref,
      ...(target.runtime_flavor ? { runtimeFlavor: target.runtime_flavor } : {}),
      enabled: target.enabled,
    });
  }

  return locations.sort((a, b) => `${a.nodeId}:${a.agentRef}`.localeCompare(`${b.nodeId}:${b.agentRef}`));
}

function matchesAgent(location: RuntimeLocation, agentId: string): boolean {
  const needle = agentId.trim();
  if (!needle) return false;
  return location.agentRef === needle
    || location.displayName === needle
    || location.targetRef === needle
    || location.targetRef?.endsWith(`:${needle}`) === true;
}

function renderLocation(location: RuntimeLocation, role?: string, prefix = '-'): string {
  const roleLabel = role ? `${role} → ` : '';
  const model = location.model ? ` · model=${location.model}` : '';
  const flavor = location.runtimeFlavor ? ` · flavor=${location.runtimeFlavor}` : '';
  const roles = location.roles.length > 0 ? ` · roles=${location.roles.join(',')}` : '';
  const target = location.targetRef ? ` · target=${location.targetRef}` : '';
  const enabled = location.enabled === false ? ' · disabled' : '';
  return `${prefix} ${roleLabel}${location.displayName} (agent=${location.agentRef}) · machine=${location.nodeId} · harness=${location.harness} · presence=${location.presence}${model}${flavor}${roles}${target}${enabled}`;
}

export function renderRuntimeRoster(nodes: RuntimeNodeRecord[], targets: RuntimeTargetRecord[] = []): string {
  const locations = buildLocations(nodes, targets);
  if (locations.length === 0) {
    return '👥 Agent roster: no runtime agents are currently registered.';
  }
  const lines = ['👥 Agent roster (role → machine → harness):'];
  for (const location of locations) lines.push(renderLocation(location));
  lines.push('', 'Use `/agora task collab <task_id>` to see the task team mapped onto this runtime roster.');
  return lines.join('\n');
}

export function renderRuntimeTeam(
  members: RuntimeTeamMember[],
  nodes: RuntimeNodeRecord[],
  targets: RuntimeTargetRecord[] = [],
): string[] {
  const locations = buildLocations(nodes, targets);
  return members.map((member) => {
    const agentId = text(member.agentId ?? member.agent_id, 'unknown');
    const match = locations.find((location) => matchesAgent(location, agentId));
    if (!match) return `- ${text(member.role, 'member')} → agent=${agentId} · machine=unresolved · harness=unresolved`;
    return renderLocation(match, text(member.role, 'member'));
  });
}

export class RuntimeRosterBridge {
  public constructor(private readonly agora: AgoraRestClient) {}

  async show(): Promise<string> {
    const [nodesResult, targetsResult] = await Promise.allSettled([
      this.agora.listRuntimeNodes(),
      this.agora.listRuntimeTargets(),
    ]);
    if (nodesResult.status === 'rejected' && targetsResult.status === 'rejected') {
      const reason = nodesResult.reason instanceof Error ? nodesResult.reason.message : String(nodesResult.reason);
      return `❌ Agent roster unavailable: ${reason}`;
    }
    const nodes = nodesResult.status === 'fulfilled' ? nodesResult.value : [];
    const targets = targetsResult.status === 'fulfilled' ? targetsResult.value : [];
    return renderRuntimeRoster(nodes, targets);
  }

  async describeTeam(members: RuntimeTeamMember[]): Promise<string[] | undefined> {
    if (members.length === 0) return [];
    const [nodesResult, targetsResult] = await Promise.allSettled([
      this.agora.listRuntimeNodes(),
      this.agora.listRuntimeTargets(),
    ]);
    if (nodesResult.status === 'rejected' && targetsResult.status === 'rejected') return undefined;
    return renderRuntimeTeam(
      members,
      nodesResult.status === 'fulfilled' ? nodesResult.value : [],
      targetsResult.status === 'fulfilled' ? targetsResult.value : [],
    );
  }
}
