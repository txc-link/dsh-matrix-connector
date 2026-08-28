/**
 * src/artifact-summary.ts — v1.0.2 artifact summary renderer.
 *
 * Given a list of artifacts (already fetched with optional `body` bytes),
 * render a Markdown block listing each artifact with metadata and the
 * first 240 characters of its body for text artifacts. Binary
 * artifacts are listed but their body is not shown.
 *
 * Why this is plugin-local (§1):
 *   - The summary block format is IM-specific Markdown.
 *   - The body truncation is a presentation choice, not a Core
 *     concept.
 *   - The byte limit (240) is a deliberate UI guard — a different
 *     IM might choose 1000 or 80.
 *
 * The `body` field on each artifact is treated as UTF-8 text; the
 * caller is responsible for decoding before passing it in. Bytes
 * exceeding the limit are truncated and '...' is appended.
 */

const DEFAULT_MAX_CHARS = 240;

export interface ArtifactInput {
  artifact_id?: string;
  name?: string;
  media_type?: string;
  size_bytes?: number;
  body?: string | Uint8Array | undefined;
}

export function summarizeArtifacts(artifacts: ArtifactInput[], maxChars: number = DEFAULT_MAX_CHARS): string {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return '';

  const lines: string[] = [`artifacts (${artifacts.length}):`];
  for (const a of artifacts) {
    const name = a.name ?? '?';
    const media = a.media_type ?? '?';
    const size = typeof a.size_bytes === 'number' ? a.size_bytes : '?';
    lines.push(` - ${name} (${media}, ${size} bytes)`);
    const isText = typeof media === 'string' && media.startsWith('text/');
    if (!isText) {
      lines.push('   (binary, content not shown)');
      continue;
    }
    if (a.body === undefined || a.body === null) {
      continue;
    }
    const text = typeof a.body === 'string' ? a.body : new TextDecoder().decode(a.body);
    if (text.length === 0) continue;
    const truncated = text.length > maxChars
      ? `${text.slice(0, maxChars)}...`
      : text;
    lines.push(`   ${truncated}`);
  }
  return lines.join('\n');
}