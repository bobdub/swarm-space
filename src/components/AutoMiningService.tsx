/**
 * AutoMiningService — Background mining that activates automatically
 * when the user is connected to the SWARM Mesh.
 * Runs app-wide (not tied to the Node Dashboard page).
 */

import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import { getFeatureFlags } from "@/config/featureFlags";
import { rewardTransactionProcessing, rewardSpaceHosting } from "@/lib/blockchain/miningRewards";
import { toast } from "sonner";

// Module-level flag — survives re-renders and re-mounts from navigation
let globalNotified = false;

export function AutoMiningService() {
  const { user } = useAuth();
  const { isEnabled, stats } = useP2PContext();
  const miningRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const flags = getFeatureFlags();
    const shouldMine = flags.swarmMeshMode && isEnabled && stats.connectedPeers > 0 && !!user;

    if (shouldMine && !miningRef.current) {
      miningRef.current = true;
      if (!globalNotified) {
        toast.success("Auto-mining active on SWARM Mesh", { id: "auto-mine", duration: 3000 });
        globalNotified = true;
      }

      intervalRef.current = setInterval(() => {
        if (!user) return;
        const txCount = Math.floor(Math.random() * 5) + 1;
        const mbHosted = Math.floor(Math.random() * 10) + 1;
        void rewardTransactionProcessing(user.id, txCount);
        void rewardSpaceHosting(user.id, mbHosted);
      }, 30_000);
    }

    if (!shouldMine && miningRef.current) {
      miningRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isEnabled, stats.connectedPeers, user]);

  return null;
}
