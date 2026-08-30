export type SecurityBoundaryKind = 'company' | 'personal-office' | 'health-vault' | 'companion';

export interface SecurityDomainConfig {
  readonly domainRef: string;
  readonly boundaryKind: SecurityBoundaryKind;
  readonly rootSpaceId: string;
  readonly requireTopLevelRoot?: boolean;
  readonly allowedRoomIds?: readonly string[];
  /** Forbidden for protected roots; accepted in the input only to fail closed. */
  readonly parentSpaceId?: string;
}

export interface SecurityDomainDeployment extends SecurityDomainConfig {
  readonly connectorId: string;
  readonly userId: string;
}

export type ProjectionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'source_domain_mismatch' | 'room_outside_boundary' | 'root_space_has_parent' };

/**
 * Fail-closed adapter boundary. One connector process/Matrix identity is
 * bound to one Core security domain and one top-level Space projection.
 */
export class SecurityDomainBoundary {
  public readonly domainRef: string;
  public readonly rootSpaceId: string;
  private readonly rooms = new Set<string>();
  private readonly requireTopLevelRoot: boolean;

  public constructor(public readonly config: SecurityDomainConfig) {
    if (!config.domainRef.trim()) throw new Error('security domainRef is required');
    if (!config.rootSpaceId.trim()) throw new Error('security rootSpaceId is required');
    this.requireTopLevelRoot = config.requireTopLevelRoot ?? true;
    if (this.requireTopLevelRoot && config.parentSpaceId) {
      throw new Error('protected security boundary root must be a top-level Space');
    }
    this.domainRef = config.domainRef;
    this.rootSpaceId = config.rootSpaceId;
    this.rooms.add(config.rootSpaceId);
    for (const roomId of config.allowedRoomIds ?? []) {
      if (roomId) this.rooms.add(roomId);
    }
  }

  public bindChildRoom(roomId: string, rootSpaceId: string): void {
    if (rootSpaceId !== this.rootSpaceId) {
      throw new Error(`security boundary root Space mismatch: expected ${this.rootSpaceId}`);
    }
    if (!roomId) throw new Error('child room id is required');
    this.rooms.add(roomId);
  }

  public unbindChildRoom(roomId: string): void {
    if (roomId !== this.rootSpaceId) this.rooms.delete(roomId);
  }

  public authorizeRoomProjection(sourceDomainRef: string, targetRoomId: string): ProjectionDecision {
    if (sourceDomainRef !== this.domainRef) {
      return { allowed: false, reason: 'source_domain_mismatch' };
    }
    if (!this.rooms.has(targetRoomId)) {
      return { allowed: false, reason: 'room_outside_boundary' };
    }
    return { allowed: true };
  }

  public verifyRootParents(parentSpaceIds: readonly string[]): ProjectionDecision {
    if (this.requireTopLevelRoot && parentSpaceIds.length > 0) {
      return { allowed: false, reason: 'root_space_has_parent' };
    }
    return { allowed: true };
  }

  public static validateDeployment(deployments: readonly SecurityDomainDeployment[]): void {
    const domains = new Set<string>();
    const roots = new Set<string>();
    const identities = new Map<string, string>();
    for (const item of deployments) {
      if (domains.has(item.domainRef)) throw new Error(`duplicate security domain: ${item.domainRef}`);
      if (roots.has(item.rootSpaceId)) throw new Error(`duplicate security root Space: ${item.rootSpaceId}`);
      const priorDomain = identities.get(item.userId);
      if (priorDomain && priorDomain !== item.domainRef) {
        throw new Error(`security domains require a dedicated bot identity: ${item.userId}`);
      }
      domains.add(item.domainRef);
      roots.add(item.rootSpaceId);
      identities.set(item.userId, item.domainRef);
    }
  }
}

