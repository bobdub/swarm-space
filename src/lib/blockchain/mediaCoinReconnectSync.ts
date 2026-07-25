/**
 * mediaCoinReconnectSync — on offline→online transitions, announce
 * any locally-created sealed media coins and kick a wrap sweep so
 * offline archives converge with the mesh once connectivity returns.
 *
 * Passive: no new gossip topics, no transport ownership. Reuses the
 * existing `p2p-connection-state` window bus and the standing wrap
 * sweep. If neither fires, this module is a no-op.
 */
import { listSealedMediaCoins } from "./syncVault";
import { runWrapSweep } from "./mediaCoinWrapSweep";

let started = false;
let lastOnline: boolean | null = null;

function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

async function onReconnect(): Promise<void> {
  try {
    const sealed = await listSealedMediaCoins();
    if (sealed.length) {
      try {
        window.dispatchEvent(new CustomEvent("media-coin-announce-batch", {
          detail: { coins: sealed.map((s) => ({ peerId: s.peerId, coinId: s.ref.coinId })) },
        }));
      } catch { /* noop */ }
    }
    await runWrapSweep().catch(() => {});
  } catch (err) {
    console.warn("[mediaCoinReconnectSync] failed", err);
  }
}

export function startReconnectSync(): void {
  if (started) return;
  started = true;
  lastOnline = isOnline();

  const handler = () => {
    const now = isOnline();
    if (lastOnline === false && now === true) {
      void onReconnect();
    }
    lastOnline = now;
  };

  if (typeof window !== "undefined") {
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    window.addEventListener("p2p-connection-state", handler as EventListener);
  }
}