/**
 * src/dispatch-args.ts — parse the positional args that follow
 *   /agora dispatch [<citizen>] <prompt...>
 *
 * Rules (kept deliberately narrow per §1.5 — shortest path):
 *   - args empty                 → throws
 *   - first token starts with `@` and is longer than 1 char
 *     → citizen_id = token minus `@`, prompt = rest joined
 *   - first token has no spaces / punctuation
 *     AND a second token exists  → citizen_id = first token,
 *                                   prompt = rest joined
 *   - otherwise                  → citizen_id = undefined,
 *                                   prompt = all tokens joined
 *
 * The middle rule is the fallback that lets a user write
 *   /agora dispatch code-reviewer 帮我审 PR
 * even when they forget the `@`. The first rule preserves the
 * unambiguous case. The third rule preserves the v0.1.1 behavior
 * for plain prompts.
 */

export interface ParsedDispatchArgs {
  citizen_id?: string | undefined;
  prompt: string;
}

export function parseDispatchArgs(args: string[]): ParsedDispatchArgs {
  if (args.length === 0) {
    throw new Error('dispatch requires a non-empty prompt');
  }

  const head = args[0]!;
  const rest = args.slice(1);

  // Case 1: explicit @mention prefix
  if (head.startsWith('@') && head.length > 1) {
    return {
      citizen_id: head.slice(1),
      prompt: rest.join(' '),
    };
  }

  // Case 2: bare word followed by another token (so "帮我审" alone
  // stays in case 3 even though it looks like a word).
  if (rest.length > 0 && /^[A-Za-z0-9._\-]+$/.test(head)) {
    return {
      citizen_id: head,
      prompt: rest.join(' '),
    };
  }

  // Case 3: plain prompt
  return {
    citizen_id: undefined,
    prompt: args.join(' '),
  };
}