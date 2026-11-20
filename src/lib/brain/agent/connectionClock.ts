/**
 * Infinity's connection clock and heartbeat tiers.
 *
 * One clock counts how long this device has stayed connected to at least one
 * peer. Every heartbeat task reads it, so there is a single source of truth
 * for "how long have we been together". A short drop (under the grace
 * window) is forgiven; a longer drop starts the count again.
 *
 * Tiers only ever add work. Seamless (no-heartbeat) tasks run at every tier.
 */

export const DROP_GRACE_MS = 2 * 60_000;

export type AgentTier = 'base' | 'converse' | 'initiate' | 'reflect' | 'deep';

/** Ordered lowest → highest. */
export const AGENT_TIERS: readonly AgentTier[] = ['base', 'converse', 'initiate', 'reflect', 'deep'];

/** Minimum connected time for each tier. */
export const TIER_START_MS: Record<AgentTier, number> = {
  base: 0,
  converse: 10 * 60_000,
  initiate: 15 * 60_000,
  reflect: 30 * 60_000,
  deep: 2 * 60 * 60_000,
};

export const TIER_LABELS: Record<AgentTier, string> = {
  base: 'Learning quietly',
  converse: 'Conversing',
  initiate: 'Joining conversations',
  reflect: 'Reflecting',
  deep: 'Deep mapping',
};

export function tierFor(connectedMs: number): AgentTier {
  let tier: AgentTier = 'base';
  for (const t of AGENT_TIERS) if (connectedMs >= TIER_START_MS[t]) tier = t;
  return tier;
}

export function tierAtLeast(tier: AgentTier, min: AgentTier): boolean {
  return AGENT_TIERS.indexOf(tier) >= AGENT_TIERS.indexOf(min);
}

/** Time left until the next tier, or null at the top. */
export function msToNextTier(connectedMs: number): { tier: AgentTier; ms: number } | null {
  const idx = AGENT_TIERS.indexOf(tierFor(connectedMs));
  const next = AGENT_TIERS[idx + 1];
  if (!next) return null;
  return { tier: next, ms: Math.max(0, TIER_START_MS[next] - connectedMs) };
}

export class ConnectionClock {
  private since: number | null = null;
  private lastSeenConnected: number | null = null;

  constructor(private readonly graceMs = DROP_GRACE_MS) {}

  /** Report the current peer count. Call on every heartbeat. */
  observe(peerCount: number, now = Date.now()): void {
    if (peerCount > 0) {
      if (this.since === null || this.lastSeenConnected === null || now - this.lastSeenConnected > this.graceMs) {
        this.since = now;
      }
      this.lastSeenConnected = now;
      return;
    }
    if (this.lastSeenConnected !== null && now - this.lastSeenConnected > this.graceMs) {
      this.since = null;
      this.lastSeenConnected = null;
    }
  }

  /** How long this device has been connected, counting forgiven drops. */
  connectedFor(now = Date.now()): number {
    if (this.since === null || this.lastSeenConnected === null) return 0;
    if (now - this.lastSeenConnected > this.graceMs) return 0;
    return Math.max(0, now - this.since);
  }

  isConnected(now = Date.now()): boolean {
    return this.lastSeenConnected !== null && now - this.lastSeenConnected <= this.graceMs;
  }
}
