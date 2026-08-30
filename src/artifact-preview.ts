const DEFAULT_MAX_CHARS = 12_000;

const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.log', '.json', '.jsonl', '.yaml', '.yml',
  '.csv', '.tsv', '.xml', '.html', '.css', '.js', '.mjs', '.cjs', '.ts',
  '.tsx', '.jsx', '.py', '.sh', '.ps1', '.sql', '.diff', '.patch',
]);

const TEXT_APPLICATION_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/markdown',
]);

export interface ArtifactPreviewInput {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface ArtifactInlinePreview {
  readonly body: string;
  readonly html: string;
  readonly truncated: boolean;
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index >= 0 ? filename.slice(index).toLowerCase() : '';
}

function isTextArtifact(filename: string, contentType: string): boolean {
  const mediaType = contentType.split(';', 1)[0]!.trim().toLowerCase();
  return mediaType.startsWith('text/')
    || TEXT_APPLICATION_TYPES.has(mediaType)
    || TEXT_EXTENSIONS.has(extensionOf(filename));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Build a safe, searchable Element timeline preview for text artifacts.
 *
 * Markdown is deliberately shown as source in a preformatted block. That
 * avoids injecting artifact-controlled HTML while still making the document
 * readable without downloading it. The complete original is sent separately
 * as the standard Matrix m.file event.
 */
export function renderArtifactInlinePreview(
  input: ArtifactPreviewInput,
  maxChars: number = DEFAULT_MAX_CHARS,
): ArtifactInlinePreview | null {
  if (!isTextArtifact(input.filename, input.contentType)) return null;
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new RangeError('maxChars must be a positive integer');
  }

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const normalized = decoded.replaceAll('\r\n', '\n');
  const truncated = normalized.length > maxChars;
  const text = truncated ? normalized.slice(0, maxChars) : normalized;
  const suffix = truncated
    ? '\n\n… 预览已截断，请下载附件查看完整文件。'
    : '\n\n完整文件同时作为附件发送。';
  const title = `📄 ${input.filename} · 群内预览`;

  return {
    body: `${title}\n\n${text}${suffix}`,
    html: `<h4>${escapeHtml(title)}</h4><pre><code>${escapeHtml(text)}</code></pre><p>${escapeHtml(suffix.trim())}</p>`,
    truncated,
  };
}
