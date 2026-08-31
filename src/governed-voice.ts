import type { MatrixClient, MatrixSendReceipt } from './matrix-client.js';
import type { SecurityDomainBoundary } from './security-domain.js';
import type { SpeechSynthesizer } from './speech-synthesis.js';

export interface InformationAuthorizationInput {
  resource_ref: string;
  actor_ref: string;
  target_domain: string;
  purpose: string;
  permission: 'read' | 'derive' | 'disclose' | 'act';
  requested_fields: string[];
}

export interface ActionRiskInput {
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
}

export interface GovernedVoiceAgora {
  authorizeInformationProjection(input: InformationAuthorizationInput): Promise<{
    allowed: boolean;
    reason: string;
    grant_id: string | null;
  }>;
  assessActionRisk(input: ActionRiskInput): Promise<{
    id: string;
    decision: 'allow' | 'require_human_gate' | 'deny';
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    reasons: string[];
  }>;
}

export interface GovernedVoiceRequest {
  readonly roomId: string;
  readonly text: string;
  readonly resourceRef: string;
  readonly sourceDomain: string;
  readonly actorRef: string;
  readonly subjectRef: string;
  readonly purpose: string;
  readonly requestedFields?: string[];
  readonly sensitiveDisclosure?: boolean;
  readonly healthImpact?: boolean;
  readonly thirdPartyEffect?: boolean;
  readonly newCounterparty?: boolean;
}

export interface GovernedVoiceDeliveryOptions {
  readonly boundary: SecurityDomainBoundary;
  readonly agora: GovernedVoiceAgora;
  readonly synthesizer: SpeechSynthesizer;
  readonly matrix: Pick<MatrixClient, 'sendAudio'>;
}

export class GovernedVoiceDelivery {
  public constructor(private readonly options: GovernedVoiceDeliveryOptions) {}

  public async deliver(input: GovernedVoiceRequest): Promise<MatrixSendReceipt> {
    const local = this.options.boundary.authorizeRoomProjection(input.sourceDomain, input.roomId);
    if (!local.allowed) throw new Error(`voice projection denied: ${local.reason}`);

    const authorization = await this.options.agora.authorizeInformationProjection({
      resource_ref: input.resourceRef,
      actor_ref: input.actorRef,
      target_domain: this.options.boundary.domainRef,
      purpose: input.purpose,
      permission: 'disclose',
      requested_fields: input.requestedFields ?? ['text'],
    });
    if (!authorization.allowed) {
      throw new Error(`voice information authorization denied: ${authorization.reason}`);
    }

    const risk = await this.options.agora.assessActionRisk({
      actor_ref: input.actorRef,
      subject_ref: input.subjectRef,
      action_kind: 'communicate',
      reversibility: 'compensatable',
      recurrence: 'one_off',
      sensitive_disclosure: input.sensitiveDisclosure ?? false,
      health_impact: input.healthImpact ?? false,
      third_party_effect: input.thirdPartyEffect ?? false,
      new_counterparty: input.newCounterparty ?? false,
      metadata: {
        resource_ref: input.resourceRef,
        target_domain: this.options.boundary.domainRef,
        channel: 'matrix-audio',
      },
    });
    if (risk.decision === 'require_human_gate') {
      throw new Error(`voice action requires Human Gate: ${risk.reasons.join(', ')}`);
    }
    if (risk.decision === 'deny') throw new Error(`voice action denied: ${risk.reasons.join(', ')}`);

    const speech = await this.options.synthesizer.synthesize(input.text);
    return this.options.matrix.sendAudio(input.roomId, {
      filename: speech.filename,
      body: input.text,
      contentType: speech.contentType,
      bytes: speech.bytes,
      durationMs: speech.durationMs,
      voice: true,
    });
  }
}
