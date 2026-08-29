/**
 * room-name.ts — R-C-2 task title → matrix room name projection.
 *
 * §1 boundary: pure function. Matrix room names allow arbitrary UTF-8
 * (中文/emoji OK), max 255 chars. We strip control chars, collapse
 * whitespace, and optionally prefix `[<taskId>] ` for recognisability.
 */

export const ROOM_NAME_MAX_LENGTH = 255;
export const UNTITLED_FALLBACK = 'untitled-task';

const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/g;
const WHITESPACE_RE = /\s+/g;

/**
 * Build a matrix-safe room name from a task title.
 *
 * @param taskTitle raw task title (may contain control chars / long / blank)
 * @param taskId    optional task id, prefixed as `[<taskId>] ` when it fits
 */
export function buildRoomName(taskTitle: string, taskId?: string): string {
  const cleaned = taskTitle
    .replace(CONTROL_CHAR_RE, ' ')
    .replace(WHITESPACE_RE, ' ')
    .trim();

  const base = cleaned.length > 0 ? cleaned : UNTITLED_FALLBACK;

  if (taskId === undefined || taskId.length === 0) {
    return base.slice(0, ROOM_NAME_MAX_LENGTH);
  }

  const prefix = `[${taskId}] `;
  const budget = ROOM_NAME_MAX_LENGTH - prefix.length;
  if (budget <= 0) {
    return base.slice(0, ROOM_NAME_MAX_LENGTH);
  }
  return `${prefix}${base.slice(0, budget)}`;
}
