/**
 * mediaCoinStuckWatch — detects media coins whose engrave has stalled
 * and seals them as immutable failed archives. Detached entries are
 * requeued through enrollContent onto fresh coins. Torrent serving is
 * uninterrupted throughout.
 */
import {
  listUnsealedMediaCoins,
  markCoinFailed,
  detachEntriesFromCoin,
  getVault,
} from "./syncVault";
import { enrollContent } from "./vaultEnroll";

export const STUCK_WRITE_MS = 120_000; // 2 min
const TICK_MS = 30_000;

let started = false;
let running = false;

function isStalled(lastAt: string | undefined, now: number): boolean {
  if (!lastAt) return false;
  const t = Date.parse(lastAt);
  if (!Number.isFinite(t)) return false;
  return now - t > STUCK_WRITE_MS;
}

/**
 * Sweep every vault once: seal-failed any stalled unsealed media coin
 * and requeue its entries. Safe to call ad-hoc (e.g. before enrolment).
 */
export async function resyncStalled(): Promise<{ failed: number; requeued: number }> {
  if (running) return { failed: 0, requeued: 0 };
  running = true;
  const now = Date.now();
  let failed = 0;
  let requeued = 0;
  try {
    const unsealed = await listUnsealedMediaCoins();
    for (const { peerId, ref } of unsealed) {
      if (ref.fillBytes <= 0) continue;
      if (!isStalled(ref.lastProgressAt ?? ref.createdAt, now)) continue;
      const detached = await detachEntriesFromCoin(peerId, ref.coinId);
      await markCoinFailed(peerId, ref.coinId);
      failed += 1;
      try {
        window.dispatchEvent(new CustomEvent("media-coin-stalled", {
          detail: { peerId, coinId: ref.coinId, entries: detached.length },
        }));
      } catch { /* noop */ }
      // Requeue every detached entry from scratch — never resume mid-percentage.
      for (const { contentHash, entry } of detached) {
        try {
          await enrollContent({
            contentHash,
            ownerPeerId: peerId.startsWith("archive:") ? "" : peerId,
            isSelf: peerId === "self",
            name: entry.name ?? contentHash,
            mime: entry.mime ?? "application/octet-stream",
            size: entry.length,
            ref: entry.ref ?? contentHash,
            completedAt: entry.completedAt,
          });
          requeued += 1;
        } catch (err) {
          console.warn("[stuckWatch] requeue failed", contentHash, err);
        }
      }
    }
  } finally {
    running = false;
  }
  return { failed, requeued };
}

export function startStuckWatch(): void {
  if (started) return;
  started = true;
  const tick = () => { void resyncStalled().catch(() => {}); };
  tick();
  setInterval(tick, TICK_MS);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") tick();
    });
  }
}

// Silence unused import warning when getVault isn't referenced yet.
void getVault;