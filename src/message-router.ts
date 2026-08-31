/**
 * message-router — pure function that classifies `/agora` slash commands
 * and returns a structured VerbDecision the bridge layer can dispatch.
 *
 * v0.1 verbs: citizen | dispatch | task | artifact | brain | im | help
 */

export type VerbName =
  | 'citizen'
  | 'dispatch'
  | 'task'
  | 'artifact'
  | 'brain'
  | 'company'
  | 'assistant'
  | 'im'
  | 'rollup'
  | 'stuck'
  | 'say'
  | 'calendar'
  | 'doc'
  | 'call'
  | 'help'
  | 'unknown';

export interface VerbDecision {
  verb: VerbName;
  args: string[];
  /** Optional raw sub-verb (e.g. 'list' for /agora citizen list). */
  subVerb?: string;
  /** Stable error code for the bridge to render. */
  errorCode?: 'UNKNOWN_VERB' | 'MISSING_ARG' | 'INVALID_SYNTAX';
}

export interface RouterOptions {
  /** The command prefix recognised (default 'agora'). */
  commandName?: string;
}

/**
 * Return true only when a Matrix message is an explicit connector command.
 *
 * Space child-room listeners share the same Matrix sync stream as the
 * top-level timeline listener.  They need a cheap way to distinguish a
 * command from ordinary room conversation before choosing the slash router
 * instead of the reply-ingest path.
 */
export function isCommandMessage(rawMessage: string, opts: RouterOptions = {}): boolean {
  const prefix = `/${opts.commandName ?? 'agora'}`;
  const text = rawMessage.trim();
  return text === prefix || text.startsWith(prefix + ' ');
}

export function route(rawMessage: string, opts: RouterOptions = {}): VerbDecision {
  const prefix = `/${opts.commandName ?? 'agora'}`;
  const text = rawMessage.trim();
  if (!text.startsWith(prefix + ' ') && text !== prefix) {
    return { verb: 'unknown', args: [], errorCode: 'UNKNOWN_VERB' };
  }
  const body = text.slice(prefix.length).trim();
  if (body.length === 0) {
    return { verb: 'help', args: [] };
  }
  const parts = body.split(/\s+/).filter((part) => part.length > 0);
  const head = parts[0];
  if (head === undefined || head.length === 0) {
    return { verb: 'help', args: [] };
  }
  const tail = parts.slice(1);

  switch (head) {
    case 'citizen': {
      if (tail.length === 0) {
        return { verb: 'citizen', args: [], subVerb: 'list' };
      }
      const sub = tail[0]!;
      if (sub === 'list') {
        return { verb: 'citizen', args: [], subVerb: 'list' };
      }
      if (sub === 'show') {
        if (tail.length < 2) {
          return { verb: 'citizen', args: tail, subVerb: 'show', errorCode: 'MISSING_ARG' };
        }
        return { verb: 'citizen', args: tail.slice(1), subVerb: 'show' };
      }
      return { verb: 'citizen', args: tail, errorCode: 'INVALID_SYNTAX' };
    }
    case 'dispatch': {
      if (tail.length === 0) {
        return { verb: 'dispatch', args: [], errorCode: 'MISSING_ARG' };
      }
      return { verb: 'dispatch', args: tail };
    }
    case 'task': {
      if (tail.length === 0) {
        return { verb: 'task', args: [], errorCode: 'MISSING_ARG' };
      }
      const sub = tail[0]!;
      if (sub === 'show') {
        if (tail.length < 2) return { verb: 'task', args: [], subVerb: 'show', errorCode: 'MISSING_ARG' };
        return { verb: 'task', args: tail.slice(1), subVerb: 'show' };
      }
      if (sub === 'pause' || sub === 'resume' || sub === 'cancel' || sub === 'unblock') {
        if (tail.length < 2) return { verb: 'task', args: [], subVerb: sub, errorCode: 'MISSING_ARG' };
        return { verb: 'task', args: tail.slice(1), subVerb: sub };
      }
      // Backward compatible: `/agora task <id> [artifacts]` shows a task.
      return { verb: 'task', args: tail };
    }
    case 'artifact': {
      if (tail.length === 0) {
        return { verb: 'artifact', args: [], errorCode: 'MISSING_ARG' };
      }
      return { verb: 'artifact', args: tail };
    }
    case 'brain': {
      if (tail.length < 2 || tail[0] !== 'search') {
        return { verb: 'brain', args: tail, errorCode: 'INVALID_SYNTAX' };
      }
      return { verb: 'brain', args: tail.slice(1), subVerb: 'search' };
    }
    case 'company': {
      if (tail.length === 0) {
        return { verb: 'company', args: [], subVerb: 'show' };
      }
      const sub = tail[0]!;
      if (sub === 'list') return { verb: 'company', args: [], subVerb: 'list' };
      if (sub === 'show') return { verb: 'company', args: tail.slice(1), subVerb: 'show' };
      return { verb: 'company', args: tail, errorCode: 'INVALID_SYNTAX' };
    }
    case 'assistant': {
      if (tail.length === 0) {
        return { verb: 'assistant', args: [], errorCode: 'INVALID_SYNTAX' };
      }
      const sub = tail[0]!;
      if (sub === 'ask') {
        if (tail.length < 2) return { verb: 'assistant', args: [], subVerb: 'ask', errorCode: 'MISSING_ARG' };
        return { verb: 'assistant', args: tail.slice(1), subVerb: 'ask' };
      }
      if (sub === 'inbox' || sub === 'commitments') {
        return { verb: 'assistant', args: tail.slice(1), subVerb: sub };
      }
      if (sub === 'show' || sub === 'reconcile') {
        if (tail.length < 2) return { verb: 'assistant', args: [], subVerb: sub, errorCode: 'MISSING_ARG' };
        return { verb: 'assistant', args: tail.slice(1), subVerb: sub };
      }
      return { verb: 'assistant', args: tail, errorCode: 'INVALID_SYNTAX' };
    }
    case 'im': {
      if (tail.length === 0) {
        return { verb: 'im', args: [], subVerb: 'help' };
      }
      return { verb: 'im', args: tail, ...(tail[0] !== undefined ? { subVerb: tail[0] } : {}) };
    }
    case 'rollup': {
      // v1.0.1 — `/agora rollup` shows the org war-room view of all rooms
      // this plugin instance has seen plus all tasks it knows about.
      // No sub-verb. No required args.
      return { verb: 'rollup', args: tail };
    }
    case 'stuck': {
      // v2.0.2 — `/agora stuck` lists tasks the plugin has seen
      // escalated via SSE inbox_escalated events in this session.
      return { verb: 'stuck', args: tail };
    }
    case 'say': {
      // v0.6 — `/agora say <text>` is an explicit proactive voice trigger.
      // The bridge dispatches this to GovernedVoiceDelivery when voice
      // delivery is wired (security boundary + speech synthesizer); otherwise
      // it returns a clear "voice not configured" reply (never silent).
      if (tail.length === 0) {
        return { verb: 'say', args: [], errorCode: 'MISSING_ARG' };
      }
      return { verb: 'say', args: tail };
    }
    case 'calendar': {
      // v0.6 — `/agora calendar today|conflicts|morning|evening [--domain work|life]`.
      // The bridge delegates to agora REST GET /api/calendar/{today,conflicts}
      // or POST /api/calendar/reports/{morning,evening}. Without RADICALE_*
      // env the upstream returns 503; we surface the gap explicitly.
      if (tail.length === 0) {
        return { verb: 'calendar', args: [], subVerb: 'today', errorCode: 'MISSING_ARG' };
      }
      const calendarSub = tail[0];
      return calendarSub !== undefined
        ? { verb: 'calendar', args: tail.slice(1), subVerb: calendarSub }
        : { verb: 'calendar', args: tail.slice(1) };
    }
    case 'doc': {
      // v0.6 — `/agora doc show|edit <artifactId> [content]` (single-writer v0.1).
      // Delegates to agora REST GET/POST /api/artifacts/:id/markdown.
      if (tail.length === 0) {
        return { verb: 'doc', args: [], subVerb: 'show', errorCode: 'MISSING_ARG' };
      }
      const docSub = tail[0];
      return docSub !== undefined
        ? { verb: 'doc', args: tail.slice(1), subVerb: docSub }
        : { verb: 'doc', args: tail.slice(1) };
    }
    case 'call': {
      // v0.6 — `/agora call join [roomId]`. Enablement only (verdict P2
      // postposed): the bridge posts the Element Call widget URL into the
      // current room. Actual SFU/TURN deploy is the user's decision.
      // When the user passes `join <roomId>` we keep `join` as subVerb and
      // drop it from args so the bridge sees only the room id (or none).
      const subVerb = tail[0] === 'join' || tail[0] === 'start' || tail[0] === 'leave' ? tail[0] : 'join';
      const args = subVerb === 'join' && tail[0] === 'join' ? tail.slice(1) : tail;
      return { verb: 'call', args, subVerb };
    }
    case 'help': {
      return { verb: 'help', args: [] };
    }
    default:
      return { verb: 'unknown', args: tail, errorCode: 'UNKNOWN_VERB' };
  }
}

/** Render an error reply for unknown / missing / invalid verbs. */
export function renderError(decision: VerbDecision, commandName = 'agora'): string {
  if (decision.errorCode === 'UNKNOWN_VERB') {
    return `❌ unknown command. type \`/${commandName} help\``;
  }
  if (decision.errorCode === 'MISSING_ARG') {
    return `❌ missing arg. usage: \`/${commandName} ${decision.verb}${decision.subVerb ? ' ' + decision.subVerb : ''} <...>\``;
  }
  if (decision.errorCode === 'INVALID_SYNTAX') {
    return `❌ invalid syntax. type \`/${commandName} help\``;
  }
  return '';
}

export const HELP_TEXT = [
  'agora bridge commands:',
  '  /agora citizen list',
  '  /agora citizen show <citizen_id>',
  '  /agora dispatch <prompt>                 (creates quick task)',
  '  /agora task <task_id> [artifacts]',
  '  /agora task show <task_id> [artifacts]',
  '  /agora task pause <task_id> [reason]',
  '  /agora task resume <task_id>',
  '  /agora task cancel <task_id> [reason]',
  '  /agora task unblock <task_id> [reason]',
  '  /agora artifact <artifact_id>',
  '  /agora brain search <query>',
  '  /agora company [show [organization] | list]',
  '  /agora assistant ask [--org <id>] [--capability <skill>] <request>',
  '  /agora assistant inbox | commitments | show <request_id> | reconcile <request_id>',
  '  /agora im health | help',
  '  /agora say <text>                    (proactive voice; needs speech config)',
  '  /agora calendar today|conflicts|morning|evening [--domain work|life]',
  '  /agora doc show|edit <artifactId> [content]',
  '  /agora call join [roomId]            (Element Call widget URL; SFU by user)',
].join('\n');
