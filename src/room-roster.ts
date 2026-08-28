/**
 * src/room-roster.ts — v0.3.2 room-roster resolver.
 *
 * In the war room each Matrix bot user_id has the shape
 *   @dsh-bridge-<agentId>:<homeserver-domain>
 *
 * The resolver strips the `dsh-bridge-` prefix and matches the
 * remaining suffix against the candidate token. This lets users type
 * `/agora dispatch node-a` in a room and have it route to the
 * `@dsh-bridge-node-a` bot, without typing the full Matrix user_id.
 *
 * Matching rules (deliberately narrow per §1.5):
 *   1. Strip leading "@" from the candidate if present.
 *   2. For each member user_id, extract its local-part (before the ":").
 *      If it starts with `dsh-bridge-`, take the rest as the agentId.
 *   3. Match candidate either exactly (full match against an agentId)
 *      or as a unique prefix (only one agentId starts with it).
 *   4. Case-sensitive — avoids accidental prefix collisions.
 *   5. Return undefined when zero or more than one agentId matches.
 *
 * The function does NOT resolve the citizen profile from agora central.
 * The downstream DispatchBridge puts the agentId into team_override and
 * agora central decides whether to accept it.
 */

const BRIDGE_PREFIX = 'dsh-bridge-';

function extractAgentId(mxid: string): string | undefined {
  const colon = mxid.indexOf(':');
  const local = colon >= 0 ? mxid.slice(1, colon) : mxid.slice(1);
  if (!local.startsWith(BRIDGE_PREFIX)) return undefined;
  const agentId = local.slice(BRIDGE_PREFIX.length);
  return agentId.length > 0 ? agentId : undefined;
}

export function resolveFromRoster(candidate: string, roster: string[]): string | undefined {
  const needle = candidate.startsWith('@') ? candidate.slice(1) : candidate;
  if (needle.length === 0) return undefined;

  const agentIds: string[] = [];
  for (const mxid of roster) {
    const agentId = extractAgentId(mxid);
    if (agentId) agentIds.push(agentId);
  }

  // Exact match wins.
  for (const id of agentIds) {
    if (id === needle) return id;
  }

  // Unique prefix match.
  const prefixHits = agentIds.filter((id) => id.startsWith(needle));
  if (prefixHits.length === 1) return prefixHits[0];

  return undefined;
}