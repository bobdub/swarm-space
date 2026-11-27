import { getCurrentUser, getCachedPrivateKey } from "@/lib/auth";
import { getCreditBalance, tipUser, transferCredits, CREDIT_REWARDS } from "@/lib/credits";
import { getSwarmChain } from "../chain";
import { getAllLiveChains, getChainBalance } from "../multiChainManager";
import { applyCreatorTokenTips, getUserProfileTokenHoldings } from "../profileTokenBalance";
import { creatorTipMove, creatorTokenAmount, creatorTokenUnits, holdingUnits, isCreatorTokenTip, planCreatorTokenTip } from "./creatorTokenTips";
import { getAppWalletBalances } from "./appWallet";
import { customTokenNetwork, customTokenRef, getAvailableTokenBalance, getRecordedTokenBalance, listCustomTokens } from "../deposits/customTokens";
import { TOKEN_NETWORKS, tokenCurrency } from "../deposits/tokenNetworks";
import { customTipAssetId, customTipUnits, CUSTOM_TIP_ASSET_PREFIX } from "../deposits/customTokenTips";
import { nativeWalletAddress, resolveNativeWalletRecipient } from "./nativeAddress";
import { signWalletTip, verifyWalletTip } from "./tipSignature";
import { validateWalletTip, type TipAsset } from "./tipRules";
import { INFINITY_GIFT_VAULT } from "../infinity/vaults";
import { availableTipWeights, resolveTipWeight, TIP_FORMAT_VERSION, type TipWeight } from "./tipWeight";
import { getAll } from "@/lib/store";
import type { SwarmCoin } from "../types";
import { assertStorageWritable } from "@/lib/storage/quotaGuard";
import type { SwarmTransaction } from "../types";
import { isNativeMintMeCustody as isNativeMintMeDeposit, mintMeAmount, mintMeUnits, NATIVE_MINTME_ASSET_ID } from "./nativeMintmeLedger";
import { isCustomTokenSync } from "../deposits/customTokenCustody";
import { notifyReceivedTips } from "./tipNotifications";
import { ethAmount, ethUnits, isNativeEthCustody, NATIVE_ETH_ASSET_ID } from "./nativeEth";

export type { TipAsset } from "./tipRules";

export async function getWalletTipAssets(userId: string): Promise<TipAsset[]> {
  const chain = getSwarmChain();
  await chain.whenReady();
  const ledger = [...chain.getChain().flatMap(b => b.transactions), ...chain.getPendingTransactions()];
  // Holdings first take in every signed creator-token tip this device has on its ledger.
  await reconcileCreatorTokenTips(userId, ledger).catch(() => 0);
  const [credits, chains, holdings, weights] = await Promise.all([
    getCreditBalance(userId), getAllLiveChains(), getUserProfileTokenHoldings(userId), getTipWeights(userId),
  ]);
  const assets: TipAsset[] = [{ id: "credits", ticker: "Credits", name: "Game credits", kind: "credits", balance: credits }];
  for (const entry of chains) {
    const balance = await getChainBalance(userId, entry.chainId);
    if (balance > 0 || entry.isMainChain) assets.push({
      id: `chain:${entry.chainId}`, ticker: entry.ticker, name: entry.chainName,
      kind: "chain", chainId: entry.chainId, balance,
      ...(entry.isMainChain ? { weights } : {}),
      unavailable: entry.isMainChain ? undefined : "Sub-chain tips await verified asset settlement. No funds will be deducted.",
    });
  }
  for (const holding of holdings) {
    if (!(holding.amount > 0)) continue;
    // What the signed creator-token ledger lets this holder move, never more than is held here.
    const { spendableUnits } = planCreatorTokenTip(ledger, userId, holding.tokenId, holdingUnits(holding.amount));
    assets.push({ id: `creator:${holding.tokenId}`, ticker: holding.ticker,
      name: "Creator token", kind: "creator", tokenId: holding.tokenId,
      creatorUserId: holding.creatorUserId, balance: creatorTokenAmount(spendableUnits),
      ...(spendableUnits > 0n ? {} : { unavailable: "This creator-token holding cannot be settled on the ledger yet. No funds will be deducted." }) });
  }
  const bridge = getAppWalletBalances(userId);
  const external = { ...bridge, MINTME: mintMeAmount(chain.getNativeMintMeBalanceUnits(userId)) };
  const nativeEth = ethAmount(chain.getNativeEthBalanceUnits(userId));
  if (nativeEth > 0) assets.push({ id: NATIVE_ETH_ASSET_ID, ticker: "ETH", name: "Ethereum (deposited)", kind: "external", balance: nativeEth });
  for (const [ticker, balance] of Object.entries(external)) {
    if (balance > 0) assets.push({ id: `external:${ticker}`, ticker, name: "External asset record",
      kind: "external", balance,
      unavailable: ticker === "MINTME" ? undefined : `${ticker} delivery is unavailable until its transfer bridge is connected. No funds will be deducted.` });
  }
  for (const token of listCustomTokens(userId)) {
    // Deposits still waiting to be shared with a peer are not spendable in the mesh yet.
    const ref = customTokenRef(token);
    const recorded = getRecordedTokenBalance(userId, ref);
    const balance = getAvailableTokenBalance(userId, ref);
    if (recorded > 0) assets.push({ id: customTipAssetId(ref), ticker: token.symbol,
      name: `Custom ${TOKEN_NETWORKS[customTokenNetwork(token)].label} token`, kind: "external", balance, decimals: token.decimals,
      ...(balance > 0 ? {} : { unavailable: `Your ${token.symbol} deposit becomes spendable once it has been shared with a connected peer. No funds will be deducted.` }) });
  }
  return assets;
}

/** Hollow, plus each engraved-coin tier this member holds. */
export async function getTipWeights(userId: string): Promise<TipWeight[]> {
  const coins = await getAll<SwarmCoin>("swarmCoins").catch(() => [] as SwarmCoin[]);
  return availableTipWeights(coins, userId);
}

/** Apply the signed creator-token tips on `ledger` that send to or from `userId` to this device's holdings, once each. */
export async function reconcileCreatorTokenTips(userId: string, ledger: readonly SwarmTransaction[]): Promise<number> {
  const moves = ledger.filter(tx => tx.from === userId || tx.to === userId).map(creatorTipMove)
    .filter((m): m is NonNullable<typeof m> => m !== null);
  if (moves.length === 0) return 0;
  const applied = await applyCreatorTokenTips(userId, moves);
  if (applied > 0 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { source: "tip" } }));
  return applied;
}

export async function receiveWalletTip(tx: SwarmTransaction): Promise<boolean> {
  // A peer's gift to the donations vault: note what happened to it for the donor board.
  const peerGift = tx?.to === INFINITY_GIFT_VAULT && tx.from !== getCurrentUser()?.id;
  const note = (refused: string | null) => {
    if (!peerGift) return;
    void import("@/lib/p2p/peerGiftLog").then(({ recordPeerGift }) => recordPeerGift({
      txId: tx.id, from: tx.from, what: `${Number(tx.amount).toLocaleString()} ${String(tx.meta?.ticker ?? "")}`.trim(), refused,
    })).catch(() => {});
  };
  if (!await verifyWalletTip(tx)) { note("its signature doesn't match the sender"); return false; }
  const chain = getSwarmChain();
  await chain.whenReady();
  const known = chain.hasTransaction(tx.id);
  if (!await chain.acceptWalletTip(tx)) { note("the sender's balance on this ledger doesn't cover it"); return false; }
  if (!known) note(null);
  const uid = getCurrentUser()?.id;
  if (uid && isCreatorTokenTip(tx) && (tx.from === uid || tx.to === uid)) {
    await reconcileCreatorTokenTips(uid, [tx]).catch(() => 0);
  }
  window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: tx }));
  window.dispatchEvent(new Event("wallet-tip-updated"));
  return true;
}

async function broadcastTip(tx: SwarmTransaction): Promise<void> {
  const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
  getSwarmMeshStandalone().broadcast("wallet-tips", tx);
  try {
    const bc = new BroadcastChannel("swarm-wallet-tips");
    bc.postMessage(tx);
    bc.close();
  } catch { /* mesh remains available */ }
}

let sending = false;
export async function sendWalletTip(params: {
  recipient: string; assetId: string; amount: number; message?: string; intent?: "tip" | "transfer";
  /** SWARM only; defaults to Hollow. */
  weight?: TipWeight;
}): Promise<SwarmTransaction | null> {
  if (sending) throw new Error("A wallet payment is already being processed");
  sending = true;
  try {
    const user = getCurrentUser();
    if (!user) throw new Error("Sign in first");
    const recipient = await resolveNativeWalletRecipient(params.recipient);
    if (recipient.id === user.id) throw new Error("Cannot send to your own wallet");
    const asset = (await getWalletTipAssets(user.id)).find(a => a.id === params.assetId);
    if (!asset) throw new Error("This asset is not in your wallet");
    validateWalletTip(asset, params.amount);
    const message = params.message?.trim();
    if (message && message.length > CREDIT_REWARDS.MAX_MESSAGE_LENGTH) throw new Error("Message is too long");
    if (asset.kind === "credits") {
      const send = params.intent === "transfer" ? transferCredits : tipUser;
      await send(recipient.id, params.amount, { message });
      return null;
    }
    if (params.weight && params.weight !== "hollow" && asset.id !== "chain:SWARM") {
      throw new Error("Only SWARM tips carry an engraving weight");
    }
    const weight = asset.id === "chain:SWARM" ? resolveTipWeight(params.weight, asset.weights ?? ["hollow"]) : undefined;
    const creatorSettlement = asset.kind === "creator" && asset.tokenId
      ? await planCreatorSettlement(user.id, asset.tokenId, params.amount) : undefined;
    await assertStorageWritable();
    const privateKey = await getCachedPrivateKey();
    if (!privateKey) throw new Error("Your wallet is locked. Sign in again before sending tokens.");
    const tx = await signWalletTip({
      id: crypto.randomUUID(), type: "wallet_tip", from: user.id, to: recipient.id,
      amount: params.amount, chainId: asset.chainId ?? "SWARM", tokenId: asset.tokenId,
      timestamp: new Date().toISOString(), nonce: Date.now(), fee: 0,
      signature: "", publicKey: user.publicKey,
      meta: { assetId: asset.id, ticker: asset.ticker, creatorUserId: asset.creatorUserId ?? null,
        ...(asset.id === NATIVE_MINTME_ASSET_ID ? { currency: "MINTME", amountUnits: mintMeUnits(params.amount).toString() } : {}),
        ...(asset.id === NATIVE_ETH_ASSET_ID ? { currency: "ETH", amountUnits: ethUnits(params.amount).toString() } : {}),
        ...(asset.id.startsWith(CUSTOM_TIP_ASSET_PREFIX) && asset.decimals !== undefined ? {
          currency: tokenCurrency(asset.id.slice(CUSTOM_TIP_ASSET_PREFIX.length)), decimals: asset.decimals,
          amountUnits: customTipUnits(params.amount, asset.decimals).toString(),
        } : {}),
        ...(creatorSettlement ?? {}),
        intent: params.intent ?? "tip", message: message ?? null,
        ...(weight ? { tipFormat: TIP_FORMAT_VERSION, weight } : {}),
        fromAddress: await nativeWalletAddress(user.id), toAddress: await nativeWalletAddress(recipient.id) },
    }, privateKey);
    if (!await receiveWalletTip(tx)) throw new Error("Wallet ownership or available balance could not be verified");
    // The ledger is authoritative. Failed delivery remains retryable, never a second debit.
    await broadcastTip(tx).catch(() => {});
    return tx;
  } finally { sending = false; }
}

/** The signed settlement fields of a creator-token tip: exact units and the sender's opening. */
async function planCreatorSettlement(userId: string, tokenId: string, amount: number): Promise<{ amountUnits: string; openingUnits: string }> {
  const chain = getSwarmChain();
  const ledger = [...chain.getChain().flatMap(b => b.transactions), ...chain.getPendingTransactions()];
  const holding = (await getUserProfileTokenHoldings(userId)).find(h => h.tokenId === tokenId);
  const { openingUnits, spendableUnits } = planCreatorTokenTip(ledger, userId, tokenId, holdingUnits(holding?.amount ?? 0));
  const units = creatorTokenUnits(amount);
  if (units > spendableUnits) throw new Error("Insufficient creator-token balance");
  return { amountUnits: units.toString(), openingUnits: openingUnits.toString() };
}

/** App-wide reception and durable-ledger rebroadcast; no route owns delivery. */
export function startWalletTipSync(): () => void {
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  const accept = (value: unknown) => {
    if (value && typeof value === "object") {
      const tx = value as SwarmTransaction;
      if (isNativeMintMeDeposit(tx)) void getSwarmChain().acceptNativeMintMeDeposit(tx).then(ok => {
        if (ok) window.dispatchEvent(new Event("blockchain-transaction"));
      }).catch(() => {});
      else if (isNativeEthCustody(tx)) void getSwarmChain().acceptNativeEthCustody(tx).then(ok => {
        if (ok) window.dispatchEvent(new Event("blockchain-transaction"));
      }).catch(() => {});
      else if (isCustomTokenSync(tx)) void getSwarmChain().acceptCustomTokenDeposit(tx).then(ok => {
        if (ok) window.dispatchEvent(new Event("blockchain-transaction"));
      }).catch(() => {});
      else void receiveWalletTip(tx).then(ok => { if (ok) return notifyMine(); }).catch(() => {});
    }
  };
  let bc: BroadcastChannel | undefined;
  try { bc = new BroadcastChannel("swarm-wallet-tips"); bc.onmessage = e => accept(e.data); } catch { /* unavailable */ }
  void import("@/lib/p2p/swarmMesh.standalone").then(({ getSwarmMeshStandalone }) => {
    if (!stopped) unsubscribe = getSwarmMeshStandalone().onMessage("wallet-tips", (_peer, tx) => accept(tx));
  });
  const notifyMine = async () => {
    const uid = getCurrentUser()?.id;
    if (!uid || stopped) return;
    const chain = getSwarmChain();
    await chain.whenReady();
    const ledger = [...chain.getChain().flatMap(b => b.transactions), ...chain.getPendingTransactions()];
    // Creator-token tips that arrived inside a synced block land in holdings here too.
    await reconcileCreatorTokenTips(uid, ledger).catch(() => 0);
    await notifyReceivedTips(ledger, uid);
  };
  const replay = async () => {
    void notifyMine().catch(() => {});
    const chain = getSwarmChain();
    await chain.whenReady();
    for (const tx of [...chain.getChain().flatMap(b => b.transactions), ...chain.getPendingTransactions()]) {
      if ((tx.type === "wallet_tip" || isNativeMintMeDeposit(tx) || isNativeEthCustody(tx) || isCustomTokenSync(tx)) && !stopped) {
        await broadcastTip(tx).catch(() => {});
      }
    }
  };
  void replay().catch(() => {});
  const timer = window.setInterval(() => void replay().catch(() => {}), 30_000);
  return () => { stopped = true; bc?.close(); unsubscribe?.(); window.clearInterval(timer); };
}