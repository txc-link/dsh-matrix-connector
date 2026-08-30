/**
 * Evaluate the inbound Matrix sender allow-list.
 *
 * `undefined` preserves the historical/default wildcard policy. An explicitly
 * empty value fails closed so a malformed deployment does not silently grant
 * access to every room member.
 */
export function isMatrixSenderAllowed(senderMxid: string, allowFrom?: string): boolean {
  if (allowFrom === undefined) return true;
  const allowedSenders = allowFrom
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowedSenders.includes('*') || allowedSenders.includes(senderMxid);
}
