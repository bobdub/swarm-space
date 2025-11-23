// Mining Implementation for SWARM tokens
import { MiningSession } from "./types";
import { getSwarmChain } from "./chain";
import { getMiningSession, saveMiningSession } from "./storage";

export async function startMining(userId: string): Promise<MiningSession> {
  const existingSession = await getMiningSession(userId);
  
  if (existingSession && existingSession.status === "active") {
    throw new Error("Mining session already active");
  }

  const session: MiningSession = {
    id: `mining-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId,
    startedAt: new Date().toISOString(),
    blocksFound: 0,
    totalReward: 0,
    hashRate: 0,
    status: "active",
  };

  await saveMiningSession(session);
  
  // Start mining loop
  mineLoop(session);

  return session;
}

async function mineLoop(session: MiningSession): Promise<void> {
  const chain = getSwarmChain();
  let hashCount = 0;
  const startTime = Date.now();

  while (session.status === "active") {
    try {
      const block = await chain.minePendingTransactions(session.userId);
      
      if (block) {
        session.blocksFound++;
        session.totalReward += block.transactions
          .filter(tx => tx.to === session.userId && tx.type === "mining_reward")
          .reduce((sum, tx) => sum + (tx.amount || 0), 0);
        
        await saveMiningSession(session);

        // Emit mining event
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("swarm-block-mined", {
              detail: { block, session },
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
      console.error("[Mining] Error in mining loop:", error);
      await pauseMining(session.userId);
      break;
    }
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

export async function resumeMining(userId: string): Promise<MiningSession | null> {
  const session = await getMiningSession(userId);
  
  if (!session || session.status !== "paused") {
    return null;
  }

  session.status = "active";
  await saveMiningSession(session);
  
  mineLoop(session);

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
