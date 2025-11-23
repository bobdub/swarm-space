// Profile Token Supply Unlocking System
import { getProfileToken, saveProfileToken } from "./storage";
import { getCreditBalance } from "../credits";
import { get, put } from "../store";

interface TokenUnlockState {
  tokenId: string;
  userId: string;
  creditsAtDeployment: number;
  lastCheckedCredits: number;
  lastUnlockedAt: string;
}

const TOKENS_PER_CREDIT = 10;

/**
 * Records the initial credit state when a token is deployed
 */
export async function recordTokenDeploymentCredits(userId: string, tokenId: string): Promise<void> {
  const currentCredits = await getCreditBalance(userId);
  
  const unlockState: TokenUnlockState = {
    tokenId,
    userId,
    creditsAtDeployment: currentCredits,
    lastCheckedCredits: currentCredits,
    lastUnlockedAt: new Date().toISOString(),
  };
  
  await put("tokenUnlockStates", unlockState);
  console.log(`[Token Unlock] Recorded deployment state for ${tokenId} at ${currentCredits} credits`);
}

/**
 * Checks if the user has earned credits since deployment and unlocks supply accordingly
 */
export async function checkAndUnlockTokenSupply(userId: string): Promise<void> {
  const token = await getProfileToken(userId);
  if (!token) return;

  const unlockState = await get<TokenUnlockState>("tokenUnlockStates", token.tokenId);
  if (!unlockState) {
    console.warn(`[Token Unlock] No unlock state found for token ${token.tokenId}`);
    return;
  }

  const currentCredits = await getCreditBalance(userId);
  const creditsEarned = currentCredits - unlockState.creditsAtDeployment;
  
  if (creditsEarned <= 0) return;

  // Calculate how many tokens should be unlocked
  const tokensToUnlock = Math.floor(creditsEarned * TOKENS_PER_CREDIT);
  const newSupply = Math.min(token.supply + tokensToUnlock, token.maxSupply);
  
  if (newSupply > token.supply) {
    const actualUnlocked = newSupply - token.supply;
    
    // Update token supply
    token.supply = newSupply;
    await saveProfileToken(token);
    
    // Add unlocked tokens to user's holdings
    const { addProfileTokens } = await import("./profileTokenBalance");
    await addProfileTokens({
      userId,
      tokenId: token.tokenId,
      ticker: token.ticker,
      creatorUserId: userId,
      amount: actualUnlocked,
    });
    
    // Update unlock state
    unlockState.lastCheckedCredits = currentCredits;
    unlockState.lastUnlockedAt = new Date().toISOString();
    await put("tokenUnlockStates", unlockState);
    
    console.log(`[Token Unlock] Unlocked ${actualUnlocked} ${token.ticker} tokens (${token.supply}/${token.maxSupply})`);
  }
}

/**
 * Gets the unlock progress for a token
 */
export async function getTokenUnlockProgress(userId: string): Promise<{
  currentSupply: number;
  maxSupply: number;
  creditsEarned: number;
  creditsNeededForMax: number;
  percentUnlocked: number;
} | null> {
  const token = await getProfileToken(userId);
  if (!token) return null;

  const unlockState = await get<TokenUnlockState>("tokenUnlockStates", token.tokenId);
  if (!unlockState) return null;

  const currentCredits = await getCreditBalance(userId);
  const creditsEarned = Math.max(0, currentCredits - unlockState.creditsAtDeployment);
  const creditsNeededForMax = Math.ceil((token.maxSupply - token.supply) / TOKENS_PER_CREDIT);
  const percentUnlocked = (token.supply / token.maxSupply) * 100;

  return {
    currentSupply: token.supply,
    maxSupply: token.maxSupply,
    creditsEarned,
    creditsNeededForMax,
    percentUnlocked,
  };
}
