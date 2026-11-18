/**
 * useMeshMining — one subscription to the SWARM mesh mining state, shared by
 * the Node Dashboard mining card and the Wallet → Mining tab so both always
 * show the same status, counters and earnings.
 */
import { useEffect, useMemo, useState } from "react";
import { getSwarmMeshStandalone, type MiningStats } from "@/lib/p2p/swarmMesh.standalone";
import { computeMiningEarnings, type MiningEarnings } from "@/lib/mining/miningSummary";

export interface MeshMiningState {
  stats: MiningStats | null;
  /** Mining toggle is on (the user wants to mine). */
  enabled: boolean;
  /** The block loop is running right now (toggle on, online, ≥1 peer). */
  active: boolean;
  /** Live peer connections held by the mesh. */
  peers: number;
  earnings: MiningEarnings;
}

function getMesh() {
  try { return getSwarmMeshStandalone(); } catch { return null; }
}

function read(): Omit<MeshMiningState, "earnings"> {
  const mesh = getMesh();
  if (!mesh) return { stats: null, enabled: false, active: false, peers: 0 };
  return {
    stats: mesh.getMiningStats(),
    enabled: mesh.getToggles().mining,
    active: mesh.isMiningActive(),
    peers: mesh.getStats().connectedPeers,
  };
}

export function useMeshMining(): MeshMiningState {
  const [state, setState] = useState(read);

  useEffect(() => {
    const mesh = getMesh();
    if (!mesh) return;
    const refresh = () => setState(read());
    const unsubs = [
      mesh.onMiningChange(refresh),
      mesh.onToggleChange(refresh),
      mesh.onPeersChange(refresh),
      mesh.onPhaseChange(refresh),
    ];
    refresh();
    return () => unsubs.forEach((u) => u());
  }, []);

  const earnings = useMemo(() => computeMiningEarnings(state.stats), [state.stats]);
  return { ...state, earnings };
}
