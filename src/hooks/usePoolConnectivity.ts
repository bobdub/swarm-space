import { useEffect, useMemo, useState } from "react";
import { useP2PContext } from "@/contexts/P2PContext";
import { getRewardPool, type RewardPoolData } from "@/lib/blockchain/storage";
import { getFeatureFlags } from "@/config/featureFlags";

/**
 * usePoolConnectivity
 * -------------------
 * Reports the currently-cached community pool alongside a liveness signal.
 *
 *   { pool, lastSyncedAt, isLive, ageMs }
 *
 * `isLive === true` when the swarm mesh is connected AND the pool snapshot
 * was refreshed within the last 60 s. UI should disable pool-mutating actions
 * whenever `!isLive` and show `lastSyncedAt` in an "offline" badge.
 */

const FRESH_MS = 60_000;

export interface PoolConnectivity {
  pool: RewardPoolData | null;
  lastSyncedAt: string | null;
  ageMs: number;
  isLive: boolean;
  isFresh: boolean;
  isConnected: boolean;
}

export function usePoolConnectivity(): PoolConnectivity {
  const { isEnabled, stats, getActivePeerConnections } = useP2PContext();
  const [pool, setPool] = useState<RewardPoolData | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const { derivePoolFromChain } = await import("@/lib/blockchain/storage");
        const p = await derivePoolFromChain();
        if (!cancelled) setPool(p);
      } catch {
        try {
          const p = await getRewardPool();
          if (!cancelled) setPool(p);
        } catch {
          /* ignore */
        }
      }
    };
    refresh();

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as RewardPoolData | undefined;
      if (detail) setPool(detail);
      else refresh();
    };
    window.addEventListener("reward-pool-update", handler);
    window.addEventListener("blockchain-transaction", refresh);

    // Age tick — every 5 s just to keep `isLive` accurate.
    const interval = window.setInterval(() => setTick((n) => n + 1), 5_000);
    const deriveInterval = window.setInterval(refresh, 30_000);

    return () => {
      cancelled = true;
      window.removeEventListener("reward-pool-update", handler);
      window.removeEventListener("blockchain-transaction", refresh);
      clearInterval(interval);
      clearInterval(deriveInterval);
    };
  }, []);

  return useMemo(() => {
    const swarmModeEnabled = getFeatureFlags().swarmMeshMode;
    const activePeerCount = Math.max(
      stats.connectedPeers,
      getActivePeerConnections().length,
    );
    const isConnected = swarmModeEnabled && isEnabled && activePeerCount > 0;

    const lastSyncedAt = pool?.lastSyncedAt ?? pool?.lastUpdated ?? null;
    const ageMs = lastSyncedAt ? Date.now() - Date.parse(lastSyncedAt) : Infinity;
    const isFresh = ageMs < FRESH_MS;
    const isLive = isConnected && isFresh;

    return { pool, lastSyncedAt, ageMs, isFresh, isConnected, isLive };
    // tick keeps ageMs refreshed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, isEnabled, stats.connectedPeers, tick]);
}

export function formatSyncAge(ageMs: number): string {
  if (!isFinite(ageMs)) return "never";
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
