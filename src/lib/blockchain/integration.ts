// Integration layer between existing credit system and blockchain
import type { AchievementDefinition, AchievementProgressRecord, CreditTransaction } from "@/types";
import { claimRewardAsSwarm } from "./token";
import { wrapAchievementAsNFT } from "./nft";
import { getCurrentUser } from "../auth";

/**
 * Convert credit rewards to SWARM tokens
 */
export async function convertCreditsToSwarm(params: {
  userId: string;
  creditAmount: number;
  reason: string;
}): Promise<void> {
  await claimRewardAsSwarm({
    userId: params.userId,
    creditAmount: params.creditAmount,
    reason: params.reason,
  });
}

/**
 * Automatically wrap unlocked achievements as NFTs
 */
export async function autoWrapAchievement(params: {
  achievement: AchievementDefinition;
  progress: AchievementProgressRecord;
}): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  await wrapAchievementAsNFT({
    achievement: params.achievement,
    progress: params.progress,
    owner: user.id,
  });
}

/**
 * Sync credit transaction to blockchain in real-time
 * Makes earning credits = mining SWARM
 */
async function syncCreditToSwarm(transaction: CreditTransaction): Promise<void> {
  // Only sync earning transactions (not spending)
  if (
    transaction.type === "achievement_reward" ||
    transaction.type === "earned_post" ||
    transaction.type === "earned_hosting"
  ) {
    try {
      await convertCreditsToSwarm({
        userId: transaction.toUserId,
        creditAmount: transaction.amount,
        reason: `Credit sync: ${transaction.type}`,
      });
      console.log(`[Blockchain] Synced ${transaction.amount} credits → SWARM for ${transaction.toUserId}`);
    } catch (error) {
      console.error("[Blockchain Integration] Failed to sync credits:", error);
    }
  }
}

/**
 * Listen to credit transactions and mint equivalent SWARM
 * This makes mining SWARM = earning credits (1:1 sync)
 */
export function syncCreditsToBlockchain(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("credit-transaction", async (event: Event) => {
    const customEvent = event as CustomEvent<CreditTransaction>;
    await syncCreditToSwarm(customEvent.detail);
  });
}

/**
 * Listen to achievement unlocks and auto-wrap as NFTs
 */
export function syncAchievementsToNFTs(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("achievement-unlocked", async (event: Event) => {
    const customEvent = event as CustomEvent<{
      achievement: AchievementDefinition;
      progress: AchievementProgressRecord;
    }>;

    try {
      await autoWrapAchievement({
        achievement: customEvent.detail.achievement,
        progress: customEvent.detail.progress,
      });
      console.log("[Blockchain] Achievement wrapped as NFT:", customEvent.detail.achievement.title);
    } catch (error) {
      console.error("[Blockchain Integration] Failed to wrap achievement:", error);
    }
  });
}

/**
 * Initialize blockchain integration
 */
export function initializeBlockchainIntegration(): void {
  syncCreditsToBlockchain();
  syncAchievementsToNFTs();
  console.log("[Blockchain] Integration initialized");
}
