/**
 * Creator Token Recovery — reconstruct a lost profileToken record from the
 * local blockchain when the `profileTokens` IndexedDB row is missing but the
 * `profile_token_deploy` transaction still exists in the chain.
 */
import { getSwarmChain } from "./chain";
import { getProfileToken, saveProfileToken, getAllProfileTokens } from "./storage";
import type { CreatorToken, SwarmTransaction } from "./types";
import {
  CREATOR_TOKEN_MAX_SUPPLY,
  CREATOR_TOKEN_INITIAL_UNLOCK_FRACTION,
  CREATOR_TOKEN_INITIAL_CREATOR_SEED,
} from "./types";

export interface RecoveryResult {
  status: "already-present" | "recovered" | "not-found";
  token?: CreatorToken;
  txId?: string;
}

/**
 * Attempt to recover the user's creator token. Called on app boot for the
 * signed-in user; safe to call repeatedly (idempotent).
 */
export async function recoverCreatorTokenFromChain(userId: string): Promise<RecoveryResult> {
  const existing = await getProfileToken(userId);
  if (existing) return { status: "already-present", token: existing };

  const chain = getSwarmChain();
  await chain.whenReady();

  // Scan chain (newest first) AND pending transactions for this user's deploy tx.
  const blocks = chain.getChain();
  const pending = chain.getPendingTransactions();
  const isDeploy = (tx: SwarmTransaction) =>
    (tx.type === "profile_token_deploy" || tx.type === "creator_token_deploy") &&
    tx.from === userId;
  let deployTx: SwarmTransaction | undefined;
  for (let i = pending.length - 1; i >= 0 && !deployTx; i--) {
    if (isDeploy(pending[i])) deployTx = pending[i];
  }
  for (let i = blocks.length - 1; i >= 0 && !deployTx; i--) {
    const txs = blocks[i].transactions ?? [];
    for (let j = txs.length - 1; j >= 0; j--) {
      if (isDeploy(txs[j])) { deployTx = txs[j]; break; }
    }
  }
  if (!deployTx) return { status: "not-found" };

  const meta = (deployTx.meta ?? {}) as Record<string, unknown>;
  const ticker = String(meta.ticker ?? "");
  const name = String(meta.tokenName ?? ticker ?? "Recovered Token");
  const tokenId = deployTx.tokenId ?? `recovered-${deployTx.id}`;
  const initialSupply =
    typeof meta.initialSupply === "number"
      ? meta.initialSupply
      : Math.floor(CREATOR_TOKEN_MAX_SUPPLY * CREATOR_TOKEN_INITIAL_UNLOCK_FRACTION);

  const token: CreatorToken = {
    tokenId,
    userId,
    name,
    ticker: ticker || "TKN",
    supply: initialSupply,
    maxSupply: CREATOR_TOKEN_MAX_SUPPLY,
    deployedAt: deployTx.timestamp,
    contractAddress: `swarm://${tokenId}`,
  };

  await saveProfileToken(token);

  // Rebuild vault + creator seed via the existing legacy migration path.
  try {
    const { ensureCreatorVault, saveCreatorVault, computeTier, getCreatorVault } = await import(
      "./creatorVault"
    );
    const vault = (await getCreatorVault(tokenId)) ?? (await ensureCreatorVault(tokenId, userId));
    const { getProfileTokenHolding, addProfileTokens } = await import("./profileTokenBalance");
    const held = await getProfileTokenHolding(userId, tokenId);
    if (!held || held.amount <= 0) {
      await addProfileTokens({
        userId,
        tokenId,
        ticker: token.ticker,
        creatorUserId: userId,
        amount: CREATOR_TOKEN_INITIAL_CREATOR_SEED,
      });
      vault.circulatingSupply += CREATOR_TOKEN_INITIAL_CREATOR_SEED;
      vault.currentTier = computeTier(vault);
      await saveCreatorVault(vault);
    }
  } catch (err) {
    console.warn("[TokenRecovery] Vault/holdings rebuild skipped:", err);
  }

  console.log(`[TokenRecovery] Restored ${token.ticker} for ${userId} from chain tx ${deployTx.id}`);
  return { status: "recovered", token, txId: deployTx.id };
}

/** Sweep all deploy transactions in the chain and back-fill any missing token rows. */
export async function recoverAllTokensFromChain(): Promise<number> {
  const chain = getSwarmChain();
  await chain.whenReady();
  const blocks = chain.getChain();
  const existing = new Set((await getAllProfileTokens()).map((t) => t.userId));
  const missingUsers = new Set<string>();
  for (const block of blocks) {
    for (const tx of block.transactions ?? []) {
      if (
        (tx.type === "profile_token_deploy" || tx.type === "creator_token_deploy") &&
        tx.from &&
        !existing.has(tx.from)
      ) {
        missingUsers.add(tx.from);
      }
    }
  }
  let recovered = 0;
  for (const uid of missingUsers) {
    const r = await recoverCreatorTokenFromChain(uid);
    if (r.status === "recovered") recovered++;
  }
  return recovered;
}