/**
 * Configuration shape for the dsh-matrix-connector Cordis plugin row.
 *
 * This module is intentionally IM-agnostic: the agora central REST URLs,
 * dispatch paths, and event polling cadence live here. Matrix-specific
 * fields (homeserverUrl, userId, accessToken, deviceId) are injected by
 * the Cordis patch at runtime.
 */

export interface MatrixConnectorConfig {
  /** Matrix homeserver base URL (e.g. https://matrix.example.org). */
  homeserverUrl: string;
  /** Bot mxid (e.g. @dsh-bridge-node-a:agent-hub.local). */
  userId: string;
  /** Bot access token provisioned via scripts/provision-bot.sh. */
  accessToken: string;
  /** Stable device id for the bot (e.g. DSH-MATRIX-CONNECTOR-NODE-A). */
  deviceId: string;

  /** Agora central REST base URL (e.g. http://127.0.0.1:18008). */
  agoraServerUrl: string;
  /** Agora central API token (Bearer). */
  agoraApiToken: string;
  /** Optional node id this connector is bound to (defaults to hostname()). */
  nodeId?: string;

  /** Outbound HTTP request timeout (ms). */
  requestTimeoutMs?: number;
  /** Slash command prefix recognised by the message router. */
  commandName?: string;
  /** Whether the connector should emit lifecycle events. */
  nodeEnabled?: boolean;
  /** Share one thread across all rooms (false = each room has its own thread). */
  shareSessionInChannel?: boolean;
  /** Allow-list of mxids (csv or '*'). */
  allowFrom?: string;
  /** Whether the bot should auto-join invited rooms. */
  autoJoin?: boolean;
  /** Event polling interval for the agora central /api/events stream (ms). */
  eventPollIntervalMs?: number;
}

export const DEFAULT_EVENT_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_COMMAND_NAME = 'agora';

/** Project id that scopes citizen / task / brain queries for this connector. */
export type ProjectId = string;

export function buildConfig(input: MatrixConnectorConfig): Required<Omit<MatrixConnectorConfig,
  | 'nodeId'
>> & { nodeId: string } {
  return {
    homeserverUrl: input.homeserverUrl,
    userId: input.userId,
    accessToken: input.accessToken,
    deviceId: input.deviceId,
    agoraServerUrl: input.agoraServerUrl,
    agoraApiToken: input.agoraApiToken,
    nodeId: input.nodeId ?? 'node-a',
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    commandName: input.commandName ?? DEFAULT_COMMAND_NAME,
    nodeEnabled: input.nodeEnabled ?? true,
    shareSessionInChannel: input.shareSessionInChannel ?? false,
    allowFrom: input.allowFrom ?? '*',
    autoJoin: input.autoJoin ?? true,
    eventPollIntervalMs: input.eventPollIntervalMs ?? DEFAULT_EVENT_POLL_INTERVAL_MS,
  };
}