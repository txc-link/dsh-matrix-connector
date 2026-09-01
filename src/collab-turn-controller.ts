export type CollabActorKind = 'human' | 'agent';

export interface CollabWakeRequest {
  roomId: string;
  taskId?: string;
  senderMxid: string;
  body: string;
  eventId?: string;
  actorKind: CollabActorKind;
  explicitCommand?: boolean;
  occurredAt?: number;
}

export interface CollabTurnPolicy {
  maxRounds: number;
  maxAgentTurnsPerRound: number;
  cooldownMs: number;
}

export interface CollabTurnDecision {
  status: 'wake' | 'ignore' | 'cooldown' | 'round_limit' | 'duplicate';
  targetRoles: string[];
  round: number;
  reason: string;
}

interface TurnState {
  round: number;
  lastWakeAt: number;
  agentTurns: number;
  events: Set<string>;
}

const ROLE_TOKEN = /(^|\s)@([a-zA-Z][a-zA-Z0-9_-]{1,63})(?=\s|$|[,:.!?])/gu;

export function parseRoleMentions(body: string): string[] {
  const roles: string[] = [];
  for (const match of body.matchAll(ROLE_TOKEN)) {
    const role = match[2]?.toLowerCase();
    if (role && !roles.includes(role)) roles.push(role);
  }
  return roles;
}

/**
 * Adapter-local loop guard. Core remains the authority for durable task state;
 * this controller only decides whether an inbound Matrix event may wake a
 * runtime turn and supplies bounded collaboration intent.
 */
export class CollabTurnController {
  private readonly states = new Map<string, TurnState>();
  private readonly policy: CollabTurnPolicy;

  constructor(policy: Partial<CollabTurnPolicy> = {}) {
    this.policy = {
      maxRounds: Math.max(1, policy.maxRounds ?? 4),
      maxAgentTurnsPerRound: Math.max(1, policy.maxAgentTurnsPerRound ?? 1),
      cooldownMs: Math.max(0, policy.cooldownMs ?? 1_500),
    };
  }

  decide(request: CollabWakeRequest): CollabTurnDecision {
    const key = `${request.roomId}\u0000${request.taskId ?? ''}`;
    const state = this.states.get(key) ?? { round: 0, lastWakeAt: 0, agentTurns: 0, events: new Set<string>() };
    const now = request.occurredAt ?? Date.now();
    if (request.eventId && state.events.has(request.eventId)) return this.decision('duplicate', state, [], 'event already observed');
    if (request.eventId) {
      state.events.add(request.eventId);
      if (state.events.size > 512) state.events.delete(state.events.values().next().value as string);
    }
    const targetRoles = parseRoleMentions(request.body);
    const explicit = request.explicitCommand === true || targetRoles.length > 0;
    if (!explicit) return this.save(key, state, this.decision('ignore', state, targetRoles, 'no explicit command or @role mention'));
    if (request.actorKind === 'agent' && targetRoles.length === 0) {
      return this.save(key, state, this.decision('ignore', state, targetRoles, 'agent messages require an explicit @role target'));
    }
    if (request.actorKind === 'agent' && state.lastWakeAt > 0 && now - state.lastWakeAt < this.policy.cooldownMs) {
      return this.save(key, state, this.decision('cooldown', state, targetRoles, 'agent turn cooldown active'));
    }
    if (request.actorKind === 'agent' && state.agentTurns >= this.policy.maxAgentTurnsPerRound) {
      return this.save(key, state, this.decision('round_limit', state, targetRoles, 'agent turn limit reached; wait for a human turn'));
    }
    if (state.round >= this.policy.maxRounds) return this.save(key, state, this.decision('round_limit', state, targetRoles, 'maximum collaboration rounds reached'));
    state.round += 1;
    state.lastWakeAt = now;
    state.agentTurns = request.actorKind === 'agent' ? state.agentTurns + 1 : 0;
    return this.save(key, state, this.decision('wake', state, targetRoles, 'explicit collaboration intent'));
  }

  reset(roomId: string, taskId?: string): void { this.states.delete(`${roomId}\u0000${taskId ?? ''}`); }

  private save(key: string, state: TurnState, decision: CollabTurnDecision): CollabTurnDecision {
    this.states.set(key, state);
    return decision;
  }

  private decision(status: CollabTurnDecision['status'], state: TurnState, targetRoles: string[], reason: string): CollabTurnDecision {
    return { status, targetRoles, round: state.round, reason };
  }
}

export function isLikelyAgentMxid(senderMxid: string): boolean {
  return /^@(?:dsh|agent|bot)[-_]/iu.test(senderMxid) || /(?:bridge|assistant|worker)[-_]/iu.test(senderMxid);
}
