import { withCreatorMarketOperation } from "./creatorMarketOperation";
import type { SwarmTransaction } from "./types";
import { tokenCurrency } from "./deposits/tokenNetworks";
import { quoteVaultBuy, type MarketVaultState } from "./marketVaultPricing";
import { releaseMinedPoolSwarm } from "./creditWrapping";
import { assertVaultCanRelease, confirmedVaultTotals, localVaultTotals, sharedMarketVaultState, unminedVaultTransactions, vaultCredits, vaultTokenHeld, vaultTotalsOf, VAULT_CREDITS_CURRENCY } from "./poolLedger";
import { getCreatorVault, priceAtSupply } from "./creatorVault";
import { getProfileTokenHolding, transferProfileTokens } from "./profileTokenBalance";
import { quoteCreatorTokenForSwarm } from "./marketVaultPricing";

export async function getCreatorMarketRate(tokenId: string): Promise<number> {
  const vault = await getCreatorVault(tokenId);
  if (!vault || vault.closed || !Number.isFinite(vault.circulatingSupply)) throw new Error("Creator market rate is unavailable.");
  return priceAtSupply(vault.circulatingSupply);
}

/** Transfer existing creator holdings into pool custody at the live profile spot. */
export async function swapCreatorTokenForSwarm(userId: string, tokenId: string, amount: number, expectedRate: number) {
  return withCreatorMarketOperation("swarm-market-vault", () => withCreatorMarketOperation(tokenId, async () => {
    const { getCurrentUser, getCachedPrivateKey } = await import("../auth");
    const { signWalletTip } = await import("./wallets/tipSignature");
    const { getSwarmChain } = await import("./chain");
    const user = getCurrentUser();
    if (!user || user.id !== userId) throw new Error("Sign in to use your Native tokens.");
    const privateKey = await getCachedPrivateKey();
    if (!privateKey) throw new Error("Your signing vault is locked. Sign in again to unlock it; no tokens have moved.");
    const [state, holding, rate] = await Promise.all([getMarketVaultState(), getProfileTokenHolding(userId, tokenId), getCreatorMarketRate(tokenId)]);
    if (rate !== expectedRate) throw new Error("Creator market rate changed. Review the updated quote and retry.");
    const quote = quoteCreatorTokenForSwarm(state, rate, amount, holding?.amount ?? 0);
    if (quote.error) throw new Error(quote.error);
    assertVaultCanRelease(await readyChain(), state, quote.out);
    const operationId = crypto.randomUUID();
    const payment = await signWalletTip({
      id: `${operationId}:payment`, type: "custom_token_transfer", from: userId, to: "community-pool",
      amount, tokenId, timestamp: new Date().toISOString(), signature: "", publicKey: user.publicKey,
      nonce: Date.now(), fee: 0, meta: { currency: `CREATOR:${tokenId}`, marketVault: true, direction: "vault-buy", rate, swarmOut: quote.out, operationId },
    }, privateKey);
    // Atomic ownership debit/credit precedes release. A failed release returns payment
    // only when no SWARM payout entered the ledger (never refund an accepted payout).
    await transferProfileTokens(userId, "community-pool", tokenId, amount);
    const chain = getSwarmChain();
    const payoutId = `${operationId}:payout`;
    try {
      await releaseMinedPoolSwarm({ to: userId, amount: quote.out, creditsLocked: 0, transactionId: payoutId, reason: `Market Vault: ${amount} ${holding?.ticker ?? tokenId} at ${rate} SWARM`,
        meta: { marketVault: true, operationId, direction: "vault-buy", tradeLeg: "payout", paidAmount: amount, paidAsset: holding?.ticker ?? `CREATOR:${tokenId}`, receivedAsset: "SWARM", rate } });
    } catch (error) {
      if (!chain.hasTransaction(payoutId)) {
        await transferProfileTokens("community-pool", userId, tokenId, amount);
        throw error;
      }
    }
    chain.addTransaction(payment);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: payment }));
      window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { tokenId } }));
      void import("../p2p/swarmMesh.standalone").then(({ getSwarmMeshStandalone }) =>
        getSwarmMeshStandalone().broadcastMarketSnapshot(tokenId)).catch(() => {});
    }
    return quote;
  }));
}

async function readyChain() {
  const { getSwarmChain } = await import("./chain");
  const chain = getSwarmChain();
  await chain.whenReady();
  return chain;
}

/**
 * Vault pool, floor, liquid and spot inputs from mined blocks only, so every
 * member on the same chain tip sees the same figures and gets the same price.
 * This device's unmined trades join once a block carries them; releases are
 * still checked against them so nothing is spent twice.
 */
export async function getMarketVaultState(): Promise<MarketVaultState> {
  return sharedMarketVaultState(await readyChain());
}

/** How many of this device's Market Vault entries are still waiting for a block. */
export async function getUnminedVaultTradeCount(): Promise<number> {
  return unminedVaultTransactions(await readyChain()).length;
}

/** Buy SWARM from the community-pool vault with Credits. Never mints; the 40% floor is never released. */
export async function buySwarmFromVault(userId: string, swarm: number) {
  return withCreatorMarketOperation("swarm-market-vault", async () => {
    const { getCreditBalance, deductCredits } = await import("../credits");
    const [state, credits] = await Promise.all([getMarketVaultState(), getCreditBalance(userId)]);
    const quote = quoteVaultBuy(state, swarm, credits);
    if (quote.error) throw new Error(quote.error);
    assertVaultCanRelease(await readyChain(), state, quote.swarm);
    await deductCredits(userId, quote.credits, `Market Vault: ${quote.credits} credits → ${quote.swarm} SWARM`);
    await releaseMinedPoolSwarm({
      to: userId,
      amount: quote.swarm,
      creditsLocked: quote.credits,
      reason: `Market Vault buy: ${quote.swarm} SWARM for ${quote.credits} credits`,
      meta: { marketVault: true, operationId: crypto.randomUUID(), direction: "vault-buy", tradeLeg: "payout", paidAmount: quote.credits, paidAsset: "Credits", receivedAsset: "SWARM" },
    });
    return quote;
  });
}

const POOL = "community-pool";

// A bare contract is a MintMe token; a `network:0x…` ref names its own chain.
const tokenCurrencyOf = (contract: string) => tokenCurrency(contract.toLowerCase());

/** Tokens the vault holds according to mined blocks: the same figure on every peer. */
export async function getVaultTokenHeld(contract: string): Promise<number> {
  return vaultTokenHeld(confirmedVaultTotals(await readyChain()), tokenCurrencyOf(contract));
}

/** Tokens the vault can pay out from this device: the shared figure less this device's unmined payouts. */
async function spendableVaultTokenHeld(contract: string): Promise<number> {
  const chain = await readyChain();
  const currency = tokenCurrencyOf(contract);
  return Math.min(vaultTokenHeld(confirmedVaultTotals(chain), currency), vaultTokenHeld(localVaultTotals(chain), currency));
}

async function addTokenTransfer(from: string, to: string, amount: number, contract: string, direction: string, meta: Record<string, unknown> = {}) {
  const { getSwarmChain } = await import("./chain");
  const { generateTransactionId } = await import("./crypto");
  const { tokenCurrency } = await import("./deposits/customTokens");
  getSwarmChain().addTransaction({
    id: generateTransactionId(), type: "custom_token_transfer", from, to, amount,
    timestamp: new Date().toISOString(), signature: "", publicKey: from, nonce: Date.now(), fee: 0,
    meta: { currency: tokenCurrency(contract), marketVault: true, direction, ...meta },
  });
}

export { VAULT_CREDITS_CURRENCY };

/**
 * A Support the Vault donation signed by the donor, so peers can check it
 * came from them before it is mined. Fails closed when the wallet is locked;
 * the caller takes nothing from the donor until this succeeds.
 */
async function signedVaultDonation(from: string, amount: number, currency: string, meta: Record<string, unknown> = {}): Promise<SwarmTransaction> {
  const { getCurrentUser, getCachedPrivateKey } = await import("../auth");
  const me = getCurrentUser();
  if (!me || me.id !== from) throw new Error("Sign in to donate from your wallet.");
  const privateKey = await getCachedPrivateKey();
  if (!privateKey || !me.publicKey) throw new Error("Your wallet is locked. Sign in again to unlock it; nothing was donated.");
  const [{ generateTransactionId }, { signWalletTip }] = await Promise.all([import("./crypto"), import("./wallets/tipSignature")]);
  return signWalletTip({
    id: generateTransactionId(), type: "custom_token_transfer", from, to: POOL, amount,
    timestamp: new Date().toISOString(), signature: "", publicKey: me.publicKey, nonce: Date.now(), fee: 0,
    meta: { currency, marketVault: true, direction: "donation", ...meta },
  } as SwarmTransaction, privateKey);
}

/** On-ledger record of Credits entering or leaving the vault's Credits reserve. Moves no SWARM. */
async function addCreditRecord(from: string, to: string, credits: number, direction: string, meta: Record<string, unknown> = {}) {
  const { getSwarmChain } = await import("./chain");
  const { generateTransactionId } = await import("./crypto");
  getSwarmChain().addTransaction({
    id: generateTransactionId(), type: "custom_token_transfer", from, to, amount: credits,
    timestamp: new Date().toISOString(), signature: "", publicKey: from, nonce: Date.now(), fee: 0,
    meta: { currency: VAULT_CREDITS_CURRENCY, marketVault: true, direction, ...meta },
  });
}

/**
 * Credits the vault holds: Credits members paid for vault buys, plus donated Credits,
 * minus Credits paid out to members who sold SWARM for Credits.
 */
export function vaultCreditReserve(ledger: readonly import("./types").SwarmTransaction[]): number {
  return vaultCredits(vaultTotalsOf(ledger));
}

/** The vault's Credits reserve according to mined blocks: the same figure on every peer. */
export async function getVaultCreditReserve(): Promise<number> {
  return vaultCredits(confirmedVaultTotals(await readyChain()));
}

/** Credits the vault can pay out from this device: the shared reserve less this device's unmined payouts. */
async function spendableVaultCreditReserve(): Promise<number> {
  const chain = await readyChain();
  return Math.min(vaultCredits(confirmedVaultTotals(chain)), vaultCredits(localVaultTotals(chain)));
}

/** Sell SWARM to the vault for Credits from its Credits reserve. */
export async function sellSwarmForCredits(userId: string, swarm: number) {
  return withCreatorMarketOperation("swarm-market-vault", async () => {
    const { getCurrentUser } = await import("../auth");
    if (getCurrentUser()?.id !== userId) throw new Error("Sign in to sell from your wallet.");
    const { getSwarmBalance, transferSwarm } = await import("./token");
    const { quoteSwarmForCredits } = await import("./marketVaultPricing");
    const [reserve, mine] = await Promise.all([spendableVaultCreditReserve(), getSwarmBalance(userId)]);
    const q = quoteSwarmForCredits(reserve, swarm, mine);
    if (q.error) throw new Error(q.error);
    const operationId = crypto.randomUUID();
    await transferSwarm({ from: userId, to: POOL, amount: swarm, meta: { marketVault: true, direction: "vault-sell", operationId, tradeLeg: "payment" } });
    await addCreditRecord(POOL, userId, q.out, "vault-sell", { operationId, tradeLeg: "payout", paidAmount: swarm, paidAsset: "SWARM", receivedAsset: "Credits" });
    const { awardVaultCredits } = await import("../credits");
    await awardVaultCredits(userId, q.out, `Market Vault: sold ${swarm} SWARM for ${q.out} credits`);
    const { derivePoolFromChain } = await import("./storage");
    await derivePoolFromChain().catch(() => {});
    return q;
  });
}

/**
 * Donate Credits to the Market Vault's Credits reserve, which pays members who sell
 * SWARM to the vault for Credits. No SWARM is released for a donation.
 */
export async function donateCreditsToVault(userId: string, credits: number) {
  return withCreatorMarketOperation("swarm-market-vault", async () => {
    if (!Number.isSafeInteger(credits) || credits <= 0) throw new Error("Donate a whole number of Credits above zero.");
    const { getCurrentUser } = await import("../auth");
    if (getCurrentUser()?.id !== userId) throw new Error("Sign in to donate from your wallet.");
    const record = await signedVaultDonation(userId, credits, VAULT_CREDITS_CURRENCY);
    const { deductCredits } = await import("../credits");
    await deductCredits(userId, credits, `Market Vault donation: ${credits} credits`);
    const { getSwarmChain } = await import("./chain");
    getSwarmChain().addTransaction(record);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("credit-transaction", { detail: { userId, amount: credits } }));
  });
}

/** Donate a synced native-wallet token (for example Dreams) to the Market Vault; nothing is paid back. */
export async function donateTokenToVault(userId: string, contract: string, amount: number) {
  return withCreatorMarketOperation("swarm-market-vault", async () => {
    const c = contract.toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount above zero.");
    const { getCurrentUser } = await import("../auth");
    if (getCurrentUser()?.id !== userId) throw new Error("Sign in to donate from your wallet.");
    const { getAvailableTokenBalance, listCustomTokens } = await import("./deposits/customTokens");
    if (amount > getAvailableTokenBalance(userId, c) + 1e-9) throw new Error("More than your available (synced) balance.");
    // Name the token so the donor leaderboard can show its symbol on every peer.
    const ticker = listCustomTokens(userId).find((t) => t.address.toLowerCase() === c)?.symbol;
    const record = await signedVaultDonation(userId, Math.round(amount * 1e8) / 1e8, tokenCurrency(c), { operationId: crypto.randomUUID(), ...(ticker ? { ticker } : {}) });
    const { getSwarmChain } = await import("./chain");
    getSwarmChain().addTransaction(record);
  });
}

/** Swap a synced native-wallet token into the vault for already-mined SWARM. */
export async function swapTokenForSwarm(userId: string, contract: string, amount: number) {
  return withCreatorMarketOperation("swarm-market-vault", async () => {
    const c = contract.toLowerCase();
    const { getAvailableTokenBalance } = await import("./deposits/customTokens");
    const { quoteTokenForSwarm } = await import("./marketVaultPricing");
    const [state, held] = await Promise.all([getMarketVaultState(), getVaultTokenHeld(c)]);
    const q = quoteTokenForSwarm(state, held, amount, getAvailableTokenBalance(userId, c));
    if (q.error) throw new Error(q.error);
    assertVaultCanRelease(await readyChain(), state, q.out);
    const operationId = crypto.randomUUID();
    await addTokenTransfer(userId, POOL, amount, c, "vault-buy", { operationId, tradeLeg: "payment" });
    await releaseMinedPoolSwarm({ to: userId, amount: q.out, creditsLocked: 0, reason: `Market Vault swap: ${amount} token → ${q.out} SWARM`,
      meta: { marketVault: true, operationId, direction: "vault-buy", tradeLeg: "payout", paidAmount: amount, paidAsset: tokenCurrency(c), receivedAsset: "SWARM" } });
    return q;
  });
}

/** Sell SWARM into the vault for a token it actually holds. */
export async function swapSwarmForToken(userId: string, contract: string, swarm: number) {
  return withCreatorMarketOperation("swarm-market-vault", async () => {
    const c = contract.toLowerCase();
    const { getSwarmBalance, transferSwarm } = await import("./token");
    const { quoteSwarmForToken } = await import("./marketVaultPricing");
    const [state, held, mine] = await Promise.all([getMarketVaultState(), spendableVaultTokenHeld(c), getSwarmBalance(userId)]);
    const q = quoteSwarmForToken(state, held, swarm, mine);
    if (q.error) throw new Error(q.error);
    const operationId = crypto.randomUUID();
    await transferSwarm({ from: userId, to: POOL, amount: swarm, meta: { marketVault: true, direction: "vault-sell", operationId, tradeLeg: "payment" } });
    await addTokenTransfer(POOL, userId, q.out, c, "vault-sell", { operationId, tradeLeg: "payout", paidAmount: swarm, paidAsset: "SWARM", receivedAsset: tokenCurrency(c) });
    const { derivePoolFromChain } = await import("./storage");
    await derivePoolFromChain().catch(() => {});
    return q;
  });
}
