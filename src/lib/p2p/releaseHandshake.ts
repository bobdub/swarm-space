/**
 * Light release check once a data channel is clear.
 *
 * A fresh channel carries the opening burst: lifecycle hints, profiles,
 * library and inventory exchange, chain and market sync. The release
 * packet is a quiet hint, so it waits until that burst is over: our
 * outgoing buffer is empty (`bufferedAmount === 0`) and the peer has gone
 * briefly quiet. A link that stays busy sends it anyway after
 * `MAX_WAIT_MS`, since the packet is only a few dozen bytes.
 */

/** Quiet time required after the last inbound message. */
export const RELEASE_IDLE_MS = 750;
/** How often a busy channel is looked at again. */
export const RELEASE_POLL_MS = 500;
/** A channel that never settles still gets the packet after this long. */
export const RELEASE_MAX_WAIT_MS = 20_000;

export interface ReleaseHandshakeDeps {
  isOpen: () => boolean;
  /** Bytes still queued to this peer (data channel plus PeerJS queue). */
  bufferedAmount: () => number;
  /** Local monotonic time of the last inbound message, or 0. */
  lastHeardAt: () => number;
  now: () => number;
  send: () => void;
  schedule?: (fn: () => void, ms: number) => unknown;
}

/** Sends once, when the channel is clear. Returns a cancel function. */
export function sendReleaseWhenClear(deps: ReleaseHandshakeDeps): () => void {
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const startedAt = deps.now();
  let cancelled = false;
  const tick = () => {
    if (cancelled || !deps.isOpen()) return;
    const t = deps.now();
    const clear = deps.bufferedAmount() === 0 && t - deps.lastHeardAt() >= RELEASE_IDLE_MS;
    if (clear || t - startedAt >= RELEASE_MAX_WAIT_MS) {
      cancelled = true;
      try { deps.send(); } catch { /* channel closed */ }
      return;
    }
    schedule(tick, RELEASE_POLL_MS);
  };
  schedule(tick, RELEASE_IDLE_MS);
  return () => { cancelled = true; };
}
