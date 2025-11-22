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
 * Listen to credit transactions and mint equivalent SWARM
 */
export function syncCreditsToBlockchain(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("credit-transaction", async (event: Event) => {
    const customEvent = event as CustomEvent<CreditTransaction>;
    const transaction = customEvent.detail;

    // Only sync certain types of transactions
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
      } catch (error) {
        console.error("[Blockchain Integration] Failed to sync credits:", error);
      }
    }
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
