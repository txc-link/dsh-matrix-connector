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
  | 'im'
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
    case 'im': {
      if (tail.length === 0) {
        return { verb: 'im', args: [], subVerb: 'help' };
      }
      return { verb: 'im', args: tail, ...(tail[0] !== undefined ? { subVerb: tail[0] } : {}) };
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
  'agora bridge — v0.1.1 commands:',
  '  /agora citizen list',
  '  /agora citizen show <citizen_id>',
  '  /agora dispatch <prompt>                 (creates quick task)',
  '  /agora task <task_id> [artifacts]',
  '  /agora artifact <artifact_id>',
  '  /agora brain search <query>',
  '  /agora im health | help',
].join('\n');