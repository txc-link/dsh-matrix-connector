/**
 * uri-parser.ts — Slice 1 of Phase 2 (matrix-connector @pull parser)
 *
 * Pure-function URI parser for `agora://<type>/<id>[/<sub>]`.
 * No IO. No state. No dependency on agora-ts/packages/core.
 *
 * Spec: Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/spec-slice-1-uri-parser.md
 * SSoT: Doc/Agora-实施排期-dsh-matrix-connector.md §2 (U1 = agora://<type>/<id>)
 *
 * @module uri-parser
 */

/** Agora URI structure parsed from input string. */
export interface AgoraUri {
  /** Always 'agora' (literal). */
  scheme: 'agora';
  /** Resource type. Must be one of VALID_TYPES. */
  type: string;
  /** Resource identifier. Must match ID_PATTERN. */
  id: string;
  /** Optional sub-path. May contain `/` (no further parsing). */
  sub?: string;
}

/** Whitelist of valid URI types. */
export const VALID_TYPES: ReadonlySet<string> = new Set([
  'task',
  'event',
  'participant',
  'execution',
  'thread',
] as const);

/**
 * Identifier pattern for `thread` URIs: the opaque threadKey produced by
 * buildThreadKey (thread-registry.ts), prefixed `mx_` + lowercase alnum.
 * Distinct from ID_PATTERN because the threadKey is adapter-generated and
 * opaque to agora central (turn 59: matrix simulates Discord threads via
 * per-thread rooms; agora central only ever sees the threadKey).
 */
export const THREAD_ID_PATTERN: RegExp = /^mx_[a-z0-9]+$/;

/**
 * Identifier pattern: `<Prefix>-<Body>` where
 *   Prefix = [A-Z][a-z]+      (Capitalized word, 2+ letters: 1 uppercase + 1+ lowercase)
 *   Body   = [A-Za-z0-9]+     (alphanumeric segment, may have multiple dashes)
 *
 * Examples:
 *   Ta-123          ✓
 *   E-abc-456       ✓
 *   X-foo-bar       ✓
 *   t-1             ✗ (lowercase prefix)
 *   T-              ✗ (empty body)
 *   123             ✗ (no prefix)
 *   Task-1          ✗ (multi-word prefix)
 *   T-1             ✗ (single-letter prefix, requires 2+ chars)
 */
export const ID_PATTERN: RegExp = /^[A-Z][a-z]+(-[A-Za-z0-9]+)+$/;

/**
 * Parse a string into an AgoraUri.
 *
 * @param input - String of form `agora://<type>/<id>[/<sub>]`
 * @returns Parsed AgoraUri object
 * @throws Error with descriptive message on invalid input
 */
export function parseAgoraUri(input: string): AgoraUri {
  if (!input || input.length === 0) {
    throw new Error('empty input');
  }

  // Split scheme: must be exactly 'agora://'
  const schemeEnd = input.indexOf('://');
  if (schemeEnd < 0) {
    throw new Error("missing scheme; expected 'agora://...'");
  }
  const scheme = input.substring(0, schemeEnd);
  if (scheme !== 'agora') {
    throw new Error(`invalid scheme '${scheme}'; expected 'agora'`);
  }

  // Remainder after scheme
  const rest = input.substring(schemeEnd + 3); // skip '://'

  // Empty rest means missing both type and id
  if (!rest || rest.length === 0) {
    throw new Error("missing type after 'agora://'");
  }

  // Split into type, id, sub by `/`
  // Note: sub may contain `/`, so we only split into max 3 parts.
  // Actually we want type, id, and sub-everything-after-second-slash
  const firstSlash = rest.indexOf('/');
  if (firstSlash < 0) {
    throw new Error("missing id after 'agora://<type>/'");
  }

  const type = rest.substring(0, firstSlash);
  if (!type || type.length === 0) {
    throw new Error("missing type after 'agora://'");
  }

  const afterType = rest.substring(firstSlash + 1);
  if (!afterType || afterType.length === 0) {
    throw new Error("missing id after 'agora://<type>/'");
  }

  const secondSlash = afterType.indexOf('/');
  let id: string;
  let sub: string | undefined;

  if (secondSlash < 0) {
    // No sub-path
    id = afterType;
    sub = undefined;
  } else {
    id = afterType.substring(0, secondSlash);
    sub = afterType.substring(secondSlash + 1);
    if (!sub || sub.length === 0) {
      throw new Error("empty sub-path after '/'");
    }
  }

  // Validate type and id
  if (!validateType(type)) {
    const validList = Array.from(VALID_TYPES).join(', ');
    throw new Error(`invalid type '${type}'; valid types: ${validList}`);
  }

  if (!validateId(id, type)) {
    const pattern = type === 'thread' ? THREAD_ID_PATTERN.source : ID_PATTERN.source;
    throw new Error(`invalid id '${id}'; expected ${type === 'thread' ? 'threadKey (mx_…)' : 'pattern <prefix>-<body>'}`);
  }

  return sub !== undefined ? { scheme: 'agora', type, id, sub } : { scheme: 'agora', type, id };
}

/**
 * Check whether a type is in VALID_TYPES.
 *
 * @param type - Type string to check
 * @returns true if type ∈ VALID_TYPES
 */
export function validateType(type: string): boolean {
  return VALID_TYPES.has(type);
}

/**
 * Check whether an id matches the pattern for its type.
 *
 * @param id - Id string to check
 * @param type - URI type; 'thread' uses THREAD_ID_PATTERN, others ID_PATTERN
 * @returns true if id matches the type's pattern
 */
export function validateId(id: string, type?: string): boolean {
  if (type === 'thread') {
    return THREAD_ID_PATTERN.test(id);
  }
  return ID_PATTERN.test(id);
}

/**
 * Reverse build: convert an AgoraUri (without scheme) to its string form.
 *
 * @param uri - AgoraUri parts (scheme is implicit 'agora')
 * @returns String form `agora://<type>/<id>[/<sub>]`
 */
export function buildAgoraUri(uri: { type: string; id: string; sub?: string }): string {
  const base = `agora://${uri.type}/${uri.id}`;
  return uri.sub ? `${base}/${uri.sub}` : base;
}
