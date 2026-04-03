/**
 * ═══════════════════════════════════════════════════════════════════════
 * UNIFIED TOKEN BLOCKLIST — Single source of truth for all noise tokens
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Imported by entityVoice.ts, languageLearner.ts, and dualLearningFusion.ts
 * to prevent operator tokens, structural P2P metadata, and pattern-derived
 * generic words from leaking into generated output.
 */

/** Structural P2P / pattern event stems — never surface as generated text */
const PATTERN_EVENT_STEMS = [
  'post_created', 'post_replied', 'post_reacted', 'post_shared', 'post_ignored',
  'propagation_success', 'propagation', 'trust_increase', 'trust_decrease',
  'gossip_sent', 'chunk_transferred', 'chunk', 'transferred',
  'created', 'replied', 'reacted', 'shared', 'ignored', 'success',
  'increase', 'decrease', 'sent',
];

/** Pattern → language readable tokens (internal transition keys only) */
const PATTERN_READABLE_TOKENS = [
  'idea', 'dialogue', 'emotion', 'connection', 'resonance',
  'quiet', 'trust', 'friction', 'energy', 'signal',
];

/** Internal signal / operator tokens */
const INTERNAL_SIGNAL_TOKENS = [
  'post', 'sync', 'mesh', 'node', 'peer', 'swarm', 'pex',
  'heartbeat', 'library', 'exchange', 'cascade', 'bootstrap',
  'handshake', 'beacon', 'presence', 'cooldown', 'dial',
  'neural', 'engine', 'layer', 'instinct', 'hierarchy',
  'in', 'motion', // ensurePhraseOutput fallback fragments
];

/** Hex-like fragments (often peer IDs leaking into vocab) */
const HEX_RE = /^[0-9a-f]{4,}$/i;

/** Combined blocklist set */
export const BLOCKED_TOKENS = new Set<string>([
  ...PATTERN_EVENT_STEMS,
  ...PATTERN_READABLE_TOKENS,
  ...INTERNAL_SIGNAL_TOKENS,
]);

/**
 * Check if a token should be blocked from generated output.
 * Returns true for blocked tokens.
 */
export function isBlockedToken(token: string): boolean {
  if (!token || token.length === 0) return true;
  const lower = token.toLowerCase().trim();
  if (lower.length === 0) return true;
  if (BLOCKED_TOKENS.has(lower)) return true;
  if (HEX_RE.test(lower)) return true;
  // Single character tokens (except emoji / symbols)
  if (lower.length === 1 && /^[a-z0-9]$/.test(lower)) return true;
  return false;
}

/**
 * Filter an array of tokens, removing blocked ones.
 */
export function filterBlockedTokens(tokens: string[]): string[] {
  return tokens.filter(t => !isBlockedToken(t));
}
