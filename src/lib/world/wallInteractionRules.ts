/** Viewer-only wall interactions: Reinforce (tip) and Graffiti (emoji stamps). */
export const REINFORCE_SWARM = 1;
export const REINFORCE_CREDITS = 10;
export const GRAFFITI_BASE_MS = 1500;
export const GRAFFITI_MAX_MS = 180_000;
export const GRAFFITI_PALETTE = ['❤️', '🔥', '💎', '🚀', '👏', '🧠', '⚡'] as const;
/** Max distance (camera ray hit, metres) at which viewer controls respond. */
export const VIEWER_REACH_M = 12;

/** Owners never reinforce or graffiti their own wall — glow must come from visitors. */
export function canViewerInteract(wall: { actorId: string }, viewerId?: string | null): boolean {
  return Boolean(viewerId && wall.actorId !== viewerId);
}

/** Each extra emoji by the same viewer on the same wall doubles the hold, capped at 3 minutes. */
export function graffitiHoldMs(priorStampsByViewer: number): number {
  const n = Math.max(0, Math.floor(priorStampsByViewer));
  return Math.min(GRAFFITI_MAX_MS, GRAFFITI_BASE_MS * 2 ** Math.min(n, 20));
}

/** SWARM first, credits as the game fallback. */
export function pickReinforcePayment(swarmBalance: number, creditBalance: number):
  { asset: 'swarm'; amount: number } | { asset: 'credits'; amount: number } | null {
  if (swarmBalance >= REINFORCE_SWARM) return { asset: 'swarm', amount: REINFORCE_SWARM };
  if (creditBalance >= REINFORCE_CREDITS) return { asset: 'credits', amount: REINFORCE_CREDITS };
  return null;
}

/** Gold lustre grows with visitor reinforcements and saturates around 20. */
export function goldLustre(count: number): { t: number; metalness: number; roughness: number; emissiveIntensity: number } {
  const t = Math.min(1, Math.max(0, count) / 20);
  return { t, metalness: 0.05 + 0.6 * t, roughness: 0.7 - 0.5 * t, emissiveIntensity: count > 0 ? 0.08 + 0.37 * t : 0 };
}
