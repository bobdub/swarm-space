// Integration layer between credit system, blockchain, and mesh
import type { AchievementDefinition, AchievementProgressRecord, CreditTransaction } from "@/types";
import { wrapAchievementAsNFT } from "./nft";
import { getCurrentUser } from "../auth";
import { recordToBlockchain } from "./blockchainRecorder";

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
 * Record credit transactions to the blockchain as ledger entries.
 * Credits are NOT auto-converted to SWARM — they must be explicitly
 * locked via the wrapping system (100 credits = 1 SWARM).
 */
function recordCreditTransaction(transaction: CreditTransaction): void {
  // Record all credit activity as blockchain ledger entries (NFT transactions)
  if (
    transaction.type === "achievement_reward" ||
    transaction.type === "earned_post" ||
    transaction.type === "earned_hosting"
  ) {
    try {
      recordToBlockchain({
        userId: transaction.toUserId,
        type: "credit_sync",
        amount: transaction.amount,
        meta: {
          creditType: transaction.type,
          description: transaction.meta?.description,
          postId: transaction.postId,
        },
      });
      console.log(`[Blockchain] Recorded credit activity: ${transaction.amount} for ${transaction.toUserId}`);
    } catch (error) {
      console.error("[Blockchain Integration] Failed to record credit:", error);
    }
  }
}

/**
 * Listen to credit transactions and record them on-chain as ledger entries
 */
export function syncCreditsToBlockchain(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("credit-transaction", async (event: Event) => {
    const customEvent = event as CustomEvent<CreditTransaction>;
    recordCreditTransaction(customEvent.detail);
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
  console.log("[Blockchain] Integration initialized — credits are ledgered, not auto-converted");
}
