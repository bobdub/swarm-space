/**
 * How long a manual dial is given before the UI calls the peer unreachable.
 *
 * ICE gathering, TURN fallback and the DTLS handshake routinely take 10–18 s
 * on mobile/carrier NATs, so the window is 20 s (24 s in a User Cell). After a
 * few seconds the UI says the handshake is still negotiating instead of
 * declaring the peer offline.
 */
export const REACHABILITY_WINDOW_MS = 20_000;
export const USER_CELL_REACHABILITY_WINDOW_MS = 24_000;
export const NEGOTIATING_NOTICE_AFTER_MS = 4_000;

export type ReachabilityStage = 'dialing' | 'negotiating' | 'expired';

export function reachabilityWindowMs(mode: string | undefined): number {
  return mode === 'builder' ? USER_CELL_REACHABILITY_WINDOW_MS : REACHABILITY_WINDOW_MS;
}

export function reachabilityStage(elapsedMs: number, windowMs: number): ReachabilityStage {
  if (elapsedMs >= windowMs) return 'expired';
  if (elapsedMs >= NEGOTIATING_NOTICE_AFTER_MS) return 'negotiating';
  return 'dialing';
}
