/**
 * transport/index.ts — public factory for MatrixTransport implementations.
 *
 * v0.4.0 surface:
 *   - createBotTransport(opts) — matrix-js-sdk-backed, default mode
 *   - createAppServiceTransport(opts) — placeholder seam; full implementation
 *     lands in T-10
 *
 * v0.6 — R-E.2 surface:
 *   - MatrixJsSdkSpaceTransport — matrix-js-sdk-backed MatrixSpaceTransport
 *     (wraps a shared SdkMatrixClient). Mounted by the composition root
 *     only when config.spaces.enabled === true.
 */

import {
  MatrixJsSdkTransport,
  type MatrixJsSdkTransportOptions,
} from './matrix-js-sdk.js';

export type BotTransportOptions = MatrixJsSdkTransportOptions;

export function createBotTransport(opts: BotTransportOptions): MatrixJsSdkTransport {
  return new MatrixJsSdkTransport(opts);
}

/**
 * App-service mode placeholder — returns a bot transport today.
 * T-10 will swap this for a real app-service-registration-backed transport
 * (requires homeserver registration YAML; out of scope for T-1).
 */
export interface AppServiceTransportOptions extends MatrixJsSdkTransportOptions {
  readonly appserviceId: string;
  readonly appserviceToken: string;
}

export function createAppServiceTransport(opts: AppServiceTransportOptions): MatrixJsSdkTransport {
  return new MatrixJsSdkTransport({
    homeserverUrl: opts.homeserverUrl,
    accessToken: opts.appserviceToken,
    userId: opts.userId,
    ...(opts.deviceId !== undefined ? { deviceId: opts.deviceId } : {}),
  });
}

export { MatrixJsSdkTransport, type CreateRoomOptions, type CreateRoomReceipt } from './matrix-js-sdk.js';
export { MatrixJsSdkSpaceTransport, type MatrixJsSdkSpaceTransportOptions } from './space-transport.js';