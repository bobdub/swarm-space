// Mining Implementation for SWARM tokens
// UQRC-Compatible: Curvature reduction in mining manifold
// [D_μ, D_ν] → 0 through template stabilization, nonce partitioning,
// propagation-aware broadcasting, and timestamp smoothing

import { MiningSession, SwarmBlock } from "./types";
import { getSwarmChain } from "./chain";
import { getMiningSession, saveMiningSession } from "./storage";
import { getOptimizedMiningEngine, OptimizedMiningEngine } from "./miningOptimizations";

// Extended mining session with UQRC metrics
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
}

export async function startMining(userId: string): Promise<OptimizedMiningSession> {
  const existingSession = await getMiningSession(userId);
  
  if (existingSession && existingSession.status === "active") {
    throw new Error("Mining session already active");
  }

  const miningEngine = getOptimizedMiningEngine();

  const session: OptimizedMiningSession = {
    id: `mining-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId,
    startedAt: new Date().toISOString(),
    blocksFound: 0,
    totalReward: 0,
    hashRate: 0,
    status: "active",
    curvatureMetrics: miningEngine.getCurvatureMetrics(),
  };

  await saveMiningSession(session);
  
  // Start optimized mining loop
  mineLoopOptimized(session, miningEngine);

  return session;
}

async function mineLoopOptimized(
  session: OptimizedMiningSession, 
  miningEngine: OptimizedMiningEngine
): Promise<void> {
  const chain = getSwarmChain();
  let hashCount = 0;
  const startTime = Date.now();

  while (session.status === "active") {
    try {
      // Use optimized mining with curvature reduction
      const block = await mineWithOptimizations(chain, session.userId, miningEngine);
      
      if (block) {
        session.blocksFound++;
        session.totalReward += block.transactions
          .filter(tx => tx.to === session.userId && tx.type === "mining_reward")
          .reduce((sum, tx) => sum + (tx.amount || 0), 0);
        
        // Update curvature metrics
        session.curvatureMetrics = miningEngine.getCurvatureMetrics();
        
        // Invalidate template after successful block
        miningEngine.invalidateTemplate();
        
        await saveMiningSession(session);

        // Check propagation awareness before broadcast
        const { shouldBroadcast, reason } = miningEngine.shouldBroadcast(block);
        
        // Emit mining event with UQRC metrics
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("swarm-block-mined", {
              detail: { 
                block, 
                session,
                curvatureMetrics: session.curvatureMetrics,
                propagationStatus: { shouldBroadcast, reason }
              },
            })
          );
        }
      }

      hashCount++;
      const elapsed = (Date.now() - startTime) / 1000;
      session.hashRate = hashCount / elapsed;

      // Throttle to prevent browser freeze
      await new Promise(resolve => setTimeout(resolve, 100));

      // Reload session to check if it was paused
      const currentSession = await getMiningSession(session.userId);
      if (currentSession && currentSession.status !== "active") {
        break;
      }
    } catch (error) {
      // Nonce partition exhausted is not a fatal error in multi-miner context
      if (error instanceof Error && error.message.includes("partition exhausted")) {
        console.log("[Mining] Nonce partition exhausted, waiting for next round");
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      console.error("[Mining] Error in mining loop:", error);
      await pauseMining(session.userId);
      break;
    }
  }
}

/**
 * Mine with all UQRC curvature-reduction optimizations applied
 */
async function mineWithOptimizations(
  chain: ReturnType<typeof getSwarmChain>,
  minerId: string,
  miningEngine: OptimizedMiningEngine
): Promise<SwarmBlock | null> {
  const pendingTransactions = chain.getPendingTransactions();
  
  if (pendingTransactions.length === 0) {
    return null;
  }

  // Use stabilized template (4.1 Template Stabilization)
  const stabilizedTransactions = miningEngine.getTemplate(pendingTransactions);
  
  // Get previous block for timestamp smoothing
  const previousBlock = chain.getLatestBlock();
  
  // Mine using optimized engine (applies 4.2, 4.3, 4.4)
  try {
    const block = await chain.minePendingTransactions(minerId);
    return block;
  } catch (error) {
    console.error("[Mining] Optimized mining error:", error);
    return null;
  }
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

export async function resumeMining(userId: string): Promise<OptimizedMiningSession | null> {
  const session = await getMiningSession(userId) as OptimizedMiningSession | null;
  
  if (!session || session.status !== "paused") {
    return null;
  }

  session.status = "active";
  await saveMiningSession(session);
  
  const miningEngine = getOptimizedMiningEngine();
  mineLoopOptimized(session, miningEngine);

  return session;
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
