// Mining — SWARM Mesh only
//
// SWARM is mined in one place: the SWARM Mesh block loop
// (swarmMesh.standalone mineChainBlock). It runs only while the node is
// online with at least one connected peer, signs every block with the
// vault's identity key, and announces it to the mesh, so every mined coin
// lives on the shared chain that peers verify.
//
// The old wallet-side loop mined blocks with no peers and no signature,
// which peers could refuse, so its SWARM never synced. It is gone: these
// helpers only report and close out legacy sessions.

import { MiningSession } from "./types";
import { getMiningSession, saveMiningSession } from "./storage";

/** Extended mining session kept for legacy records. */
export interface OptimizedMiningSession extends MiningSession {
  curvatureMetrics?: {
    templateCurvature: number;
    nonceCurvature: number;
    propagationCurvature: number;
    timestampCurvature: number;
    totalQScore: number;
  };
  noncePartition?: number;
  peersConnected?: number;
  /** Which chain this session is mining for */
  chainId?: string;
  chainTicker?: string;
}

export const MESH_ONLY_MINING_MESSAGE =
  "SWARM is only mined on the SWARM Mesh, while you're online with a peer, so every block reaches the shared chain. Turn mining on from the Node Dashboard.";

/** Refuses: a block mined outside the mesh would never sync. */
export async function startMining(_userId: string): Promise<OptimizedMiningSession> {
  throw new Error(MESH_ONLY_MINING_MESSAGE);
}

export async function pauseMining(userId: string): Promise<MiningSession | null> {
  const session = await getMiningSession(userId);

  if (!session || session.status !== "active") {
    return null;
  }

  session.status = "paused";
  await saveMiningSession(session);

  return session;
}

/** Refuses: a block mined outside the mesh would never sync. */
export async function resumeMining(_userId: string): Promise<OptimizedMiningSession | null> {
  throw new Error(MESH_ONLY_MINING_MESSAGE);
}

export async function stopMining(userId: string): Promise<MiningSession | null> {
  const session = await getMiningSession(userId);

  if (!session) {
    return null;
  }

  session.status = "completed";
  session.endedAt = new Date().toISOString();
  await saveMiningSession(session);

  return session;
}

export async function getMiningStats(userId: string): Promise<MiningSession | null> {
  return getMiningSession(userId);
}
