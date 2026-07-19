// Creator Token Deployment on SWARM blockchain
// One per account, max 10,000 supply, costs 1,000 credits
import {
  CreatorToken,
  SwarmTransaction,
  CREATOR_TOKEN_MAX_SUPPLY,
  CREATOR_TOKEN_INITIAL_UNLOCK_FRACTION,
  CREATOR_TOKEN_INITIAL_CREATOR_SEED,
  CREATOR_VAULT_BUYBACK_SHARE,
  CREATOR_VAULT_STABILITY_SHARE,
  CREATOR_VAULT_CREATOR_SHARE,
} from "./types";
// Keep ProfileToken alias for backward compat
import type { ProfileToken } from "./types";
import { getSwarmChain } from "./chain";
import { generateTransactionId, generateTokenId } from "./crypto";
import { getProfileToken, saveProfileToken } from "./storage";

export async function deployProfileToken(params: {
  userId: string;
  name: string;
  ticker: string;
  description?: string;
  image?: string;
}): Promise<{ token: ProfileToken; transaction: SwarmTransaction }> {
  // Check credit balance
  const { getCreditBalance, deductCredits } = await import("../credits");
  const { getDeployPricing } = await import("./deployPricing");
  const pricing = await getDeployPricing();
  const balance = await getCreditBalance(params.userId);
  
  if (balance < pricing.creatorTokenCredits) {
    throw new Error(`Insufficient credits. Need ${pricing.creatorTokenCredits} credits to deploy a Creator Token.`);
  }

  // Check SWARM balance for the market-launch fee
  const { getSwarmBalance, burnSwarm } = await import("./token");
  const swarmBalance = await getSwarmBalance(params.userId);
  if (swarmBalance < pricing.creatorTokenSwarm) {
    throw new Error(
      `Insufficient SWARM. Need ${pricing.creatorTokenSwarm} SWARM to launch the token market.`,
    );
  }

  // Check if user already has a profile token
  const existing = await getProfileToken(params.userId);

  if (existing) {
    const { hasProfileTokenBeenUsed } = await import("./profileTokenUsage");
    const used = await hasProfileTokenBeenUsed(existing.userId, existing.tokenId);

    if (used) {
      throw new Error("Profile token already in use and cannot be redeployed");
    }
  }

  // Deduct deployment cost
  await deductCredits(params.userId, pricing.creatorTokenCredits, "Creator Token Deployment");
  // Burn SWARM to launch the market — routed through the creator vault below.
  await burnSwarm({
    from: params.userId,
    amount: pricing.creatorTokenSwarm,
    reason: "Creator Token market launch fee",
  });

  // Validate ticker (3-5 uppercase letters)
  if (!/^[A-Z]{3,5}$/.test(params.ticker)) {
    throw new Error("Ticker must be 3-5 uppercase letters");
  }

  // Supply unlock model:
  //   • 40% of max supply is unlocked and marketable at deployment.
  //   • Remaining 60% unlocks gradually as the creator earns credits.
  const initialSupply = Math.floor(CREATOR_TOKEN_MAX_SUPPLY * CREATOR_TOKEN_INITIAL_UNLOCK_FRACTION);
  const creatorSeed = CREATOR_TOKEN_INITIAL_CREATOR_SEED;
  const tokenId = existing ? existing.tokenId : generateTokenId();

  const profileToken: CreatorToken = {
    tokenId,
    userId: params.userId,
    name: params.name,
    ticker: params.ticker,
    supply: initialSupply,
    maxSupply: CREATOR_TOKEN_MAX_SUPPLY,
    deployedAt: new Date().toISOString(),
    contractAddress: `swarm://${tokenId}`,
    description: params.description,
    image: params.image,
  };

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "profile_token_deploy",
    from: params.userId,
    to: params.userId,
    tokenId,
    amount: creatorSeed,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      tokenName: params.name,
      ticker: params.ticker,
      maxSupply: CREATOR_TOKEN_MAX_SUPPLY,
      initialSupply,
      creatorSeed,
      seedSwarm: pricing.creatorTokenSwarm,
      communityShare: Math.round(pricing.creatorTokenSwarm * (1 - CREATOR_VAULT_BUYBACK_SHARE - CREATOR_VAULT_STABILITY_SHARE - CREATOR_VAULT_CREATOR_SHARE) * 1e6) / 1e6,
      pricing,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  await saveProfileToken(profileToken);

  // Seed the creator with `creatorSeed` tokens as the first "sale", backed by
  // the 50 SWARM deployment fee routed 40/40/15/5 through the vault.
  const { addProfileTokens } = await import("./profileTokenBalance");
  await addProfileTokens({
    userId: params.userId,
    tokenId,
    ticker: params.ticker,
    creatorUserId: params.userId,
    amount: creatorSeed,
  });

  // Record deployment state for gradual unlock
  const { recordTokenDeploymentCredits } = await import("./profileTokenUnlock");
  await recordTokenDeploymentCredits(params.userId, tokenId);

  // Initialize the Creator Vault and seed it with the 50 SWARM deployment fee
  // as the first sale — 40/40/15/5 split, creator receives `creatorSeed` tokens.
  const { ensureCreatorVault, saveCreatorVault, computeTier } = await import("./creatorVault");
  const vault = await ensureCreatorVault(tokenId, params.userId);
  const swarmSeed = pricing.creatorTokenSwarm;
  const buyback = Math.round(swarmSeed * CREATOR_VAULT_BUYBACK_SHARE * 1e6) / 1e6;
  const stability = Math.round(swarmSeed * CREATOR_VAULT_STABILITY_SHARE * 1e6) / 1e6;
  const creatorEarn = Math.round(swarmSeed * CREATOR_VAULT_CREATOR_SHARE * 1e6) / 1e6;
  const community = Math.round((swarmSeed - buyback - stability - creatorEarn) * 1e6) / 1e6;
  vault.buybackReserve += buyback;
  vault.stabilityFloor += stability;
  vault.creatorEarnings += creatorEarn;
  vault.communityContributed += community;
  vault.totalDeposited += swarmSeed;
  vault.circulatingSupply += creatorSeed;
  vault.currentTier = computeTier(vault);
  await saveCreatorVault(vault);

  try {
    const { derivePoolFromChain } = await import("./storage");
    await derivePoolFromChain();
  } catch (err) {
    console.warn("[CreatorToken] Community pool derivation failed:", err);
  }

  console.log(
    `[CreatorToken] Deployed ${params.ticker} — supply ${initialSupply}/${CREATOR_TOKEN_MAX_SUPPLY} unlocked, ` +
      `seeded ${creatorSeed} tokens to creator via ${swarmSeed} SWARM vault split`,
  );

  return { token: profileToken, transaction };
}

/** @deprecated Use deployProfileToken — Creator Tokens are one-per-account */
export async function mintProfileToken(params: {
  userId: string;
  amount: number;
  recipient: string;
}): Promise<SwarmTransaction> {
  const token = await getProfileToken(params.userId);
  if (!token) {
    throw new Error("Profile token not deployed");
  }

  if (token.supply + params.amount > token.maxSupply) {
    throw new Error(`Cannot exceed max supply of ${token.maxSupply}`);
  }

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "token_mint",
    from: params.userId,
    to: params.recipient,
    amount: params.amount,
    tokenId: token.tokenId,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      profileToken: true,
      ticker: token.ticker,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  // Update supply
  token.supply += params.amount;
  await saveProfileToken(token);

  // Track recipient's balance
  const { addProfileTokens } = await import("./profileTokenBalance");
  await addProfileTokens({
    userId: params.recipient,
    tokenId: token.tokenId,
    ticker: token.ticker,
    creatorUserId: params.userId,
    amount: params.amount,
  });

  return transaction;
}

export async function getUserProfileToken(userId: string): Promise<CreatorToken | null> {
  const token = await getProfileToken(userId);
  if (!token) return null;
  // Legacy migration: tokens deployed before Creator Vaults existed have no
  // vault and often have supply=0 (old semantics tracked mint count). Waive
  // the 50 SWARM fee for these users and back-fill:
  //   • ensure a vault exists (empty — no deposits since fee was never paid)
  //   • lift `supply` to the 40% initial unlock so the market has stock
  //   • seed the creator's balance with the 100-token creator seed if empty
  try {
    const { getCreatorVault, ensureCreatorVault, saveCreatorVault, computeTier } =
      await import("./creatorVault");
    const existingVault = await getCreatorVault(token.tokenId);
    if (!existingVault) {
      const vault = await ensureCreatorVault(token.tokenId, token.userId);
      const initialUnlock = Math.floor(
        CREATOR_TOKEN_MAX_SUPPLY * CREATOR_TOKEN_INITIAL_UNLOCK_FRACTION,
      );
      let changed = false;
      if (!token.supply || token.supply < initialUnlock) {
        token.supply = Math.max(token.supply || 0, initialUnlock);
        changed = true;
      }
      if (changed) {
        await saveProfileToken(token);
      }
      // Seed creator with 100 tokens if they don't hold any of their own token
      try {
        const { getProfileTokenHolding, addProfileTokens } = await import(
          "./profileTokenBalance"
        );
        const held = await getProfileTokenHolding(token.userId, token.tokenId);
        if (!held || held.amount <= 0) {
          await addProfileTokens({
            userId: token.userId,
            tokenId: token.tokenId,
            ticker: token.ticker,
            creatorUserId: token.userId,
            amount: CREATOR_TOKEN_INITIAL_CREATOR_SEED,
          });
          vault.circulatingSupply += CREATOR_TOKEN_INITIAL_CREATOR_SEED;
          vault.currentTier = computeTier(vault);
          await saveCreatorVault(vault);
        }
      } catch (err) {
        console.warn("[CreatorToken] Legacy seed backfill skipped:", err);
      }
      console.log(
        `[CreatorToken] Legacy token ${token.ticker} migrated — vault created, ` +
          `deploy fee waived, supply=${token.supply}/${token.maxSupply}`,
      );
    }
  } catch (err) {
    console.warn("[CreatorToken] Legacy migration skipped:", err);
  }
  return token;
}

/** Alias for getUserProfileToken */
export const getUserCreatorToken = getUserProfileToken;

export function getMaxProfileTokenSupply(): number {
  return CREATOR_TOKEN_MAX_SUPPLY;
}
