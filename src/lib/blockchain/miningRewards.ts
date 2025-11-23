// Mining rewards through network participation
import { mintSwarm } from "./token";

const MINING_REWARDS = {
  TRANSACTION_PROCESSED: 0.1,
  MB_HOSTED: 0.05,
  PEER_CONNECTION: 0.02,
} as const;

export async function rewardTransactionProcessing(userId: string, txCount: number): Promise<void> {
  const reward = txCount * MINING_REWARDS.TRANSACTION_PROCESSED;
  
  await mintSwarm({
    to: userId,
    amount: reward,
    reason: `Processing ${txCount} transactions in mesh network`,
  });

  // Dispatch credit transaction event
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("credit-transaction", {
      detail: {
        id: crypto.randomUUID(),
        fromUserId: "system",
        toUserId: userId,
        amount: reward,
        type: "earned_hosting",
        createdAt: new Date().toISOString(),
        meta: { transactions: txCount },
      },
    }));
  }
}

export async function rewardSpaceHosting(userId: string, megabytesHosted: number): Promise<void> {
  const reward = megabytesHosted * MINING_REWARDS.MB_HOSTED;
  
  await mintSwarm({
    to: userId,
    amount: reward,
    reason: `Hosting ${megabytesHosted}MB in mesh network`,
  });

  // Dispatch credit transaction event
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("credit-transaction", {
      detail: {
        id: crypto.randomUUID(),
        fromUserId: "system",
        toUserId: userId,
        amount: reward,
        type: "earned_hosting",
        createdAt: new Date().toISOString(),
        meta: { megabytesHosted },
      },
    }));
  }
}

export async function rewardPeerConnection(userId: string): Promise<void> {
  const reward = MINING_REWARDS.PEER_CONNECTION;
  
  await mintSwarm({
    to: userId,
    amount: reward,
    reason: "Establishing peer connection",
  });
}

export function getMiningRewards() {
  return MINING_REWARDS;
}
