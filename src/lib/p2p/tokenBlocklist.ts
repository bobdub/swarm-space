const BLOCKED_TOKEN_VALUES = [
  // Internal signal / operator tokens
  'post', 'posted', 'reply', 'replied', 'reaction', 'reacted', 'shared',
  'propagation', 'success', 'event', 'metric', 'metrics', 'engagement',
  'created', 'comment', 'sync', 'update', 'data', 'type', 'undefined',
  'null', 'true', 'false', 'object', 'function', 'string', 'number',
  // Pattern/event stems and lifecycle terms
  'ignored', 'increase', 'decrease', 'transfer', 'transferred',
  // Pattern-readable bridge tokens (transition-only; avoid raw output leakage)
  'idea', 'dialogue', 'emotion', 'connection', 'resonance', 'quiet', 'trust', 'friction',
];

export const BLOCKED_TOKENS = new Set(BLOCKED_TOKEN_VALUES);

export function isBlockedToken(token: string): boolean {
  return BLOCKED_TOKENS.has(token.toLowerCase());
}
