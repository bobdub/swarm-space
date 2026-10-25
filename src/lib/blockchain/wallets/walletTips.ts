import { getCurrentUser, getCachedPrivateKey } from "@/lib/auth";
import { getCreditBalance, tipUser, transferCredits, CREDIT_REWARDS } from "@/lib/credits";
import { getSwarmChain } from "../chain";
import { getAllLiveChains, getChainBalance } from "../multiChainManager";
import { getUserProfileTokenHoldings } from "../profileTokenBalance";
import { getAppWalletBalances } from "./appWallet";
import { getChainMintmeBalance } from "../deposits/mintmeDeposit";
import { getRecordedTokenBalance, listCustomTokens } from "../deposits/customTokens";
import { nativeWalletAddress, resolveNativeWalletRecipient } from "./nativeAddress";
import { signWalletTip, verifyWalletTip } from "./tipSignature";
import { validateWalletTip, type TipAsset } from "./tipRules";
import { assertStorageWritable } from "@/lib/storage/quotaGuard";
import type { SwarmTransaction } from "../types";

export type { TipAsset } from "./tipRules";

export async function getWalletTipAssets(userId: string): Promise<TipAsset[]> {
  const chain = getSwarmChain();
  await chain.whenReady();
  const [credits, chains, holdings] = await Promise.all([
    getCreditBalance(userId), getAllLiveChains(), getUserProfileTokenHoldings(userId),
  ]);
  const assets: TipAsset[] = [{ id: "credits", ticker: "Credits", name: "Game credits", kind: "credits", balance: credits }];
  for (const entry of chains) {
    const balance = await getChainBalance(userId, entry.chainId);
    if (balance > 0 || entry.isMainChain) assets.push({
      id: `chain:${entry.chainId}`, ticker: entry.ticker, name: entry.chainName,
      kind: "chain", chainId: entry.chainId, balance,
      unavailable: entry.isMainChain ? undefined : "Sub-chain tips await verified asset settlement. No funds will be deducted.",
    });
  }
  for (const holding of holdings) {
    if (holding.amount > 0) assets.push({ id: `creator:${holding.tokenId}`, ticker: holding.ticker,
      name: "Creator token", kind: "creator", tokenId: holding.tokenId,
      creatorUserId: holding.creatorUserId, balance: holding.amount,
      unavailable: "Creator token tips await verified ownership settlement. No funds will be deducted." });
  }
  const bridge = getAppWalletBalances(userId);
  const external = { ...bridge, MINTME: Math.max(bridge.MINTME, getChainMintmeBalance(userId)) };
  for (const [ticker, balance] of Object.entries(external)) {
    if (balance > 0) assets.push({ id: `external:${ticker}`, ticker, name: "External asset record",
      kind: "external", balance,
      unavailable: `${ticker} delivery is unavailable until its transfer bridge is connected. No funds will be deducted.` });
  }
  for (const token of listCustomTokens(userId)) {
    const balance = getRecordedTokenBalance(userId, token.address);
    if (balance > 0) assets.push({ id: `custom:${token.address}`, ticker: token.symbol,
      name: "Custom MintMe token", kind: "external", balance,
      unavailable: `${token.symbol} mesh transfers await verified settlement. No funds will be deducted.` });
  }
  return assets;
}

export async function receiveWalletTip(tx: SwarmTransaction): Promise<boolean> {
  if (!await verifyWalletTip(tx)) return false;
  const chain = getSwarmChain();
  await chain.whenReady();
  if (!await chain.acceptWalletTip(tx)) return false;
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
}): Promise<void> {
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
      return;
    }
    await assertStorageWritable();
    const privateKey = await getCachedPrivateKey();
    if (!privateKey) throw new Error("Unlock your account before sending wallet tokens");
    const tx = await signWalletTip({
      id: crypto.randomUUID(), type: "wallet_tip", from: user.id, to: recipient.id,
      amount: params.amount, chainId: asset.chainId ?? "SWARM", tokenId: asset.tokenId,
      timestamp: new Date().toISOString(), nonce: Date.now(), fee: 0,
      signature: "", publicKey: user.publicKey,
      meta: { assetId: asset.id, ticker: asset.ticker, creatorUserId: asset.creatorUserId ?? null,
        intent: params.intent ?? "tip", message: message ?? null,
        fromAddress: await nativeWalletAddress(user.id), toAddress: await nativeWalletAddress(recipient.id) },
    }, privateKey);
    if (!await receiveWalletTip(tx)) throw new Error("Wallet ownership or available balance could not be verified");
    // The ledger is authoritative. Failed delivery remains retryable, never a second debit.
    await broadcastTip(tx).catch(() => {});
  } finally { sending = false; }
}

/** App-wide reception and durable-ledger rebroadcast; no route owns delivery. */
export function startWalletTipSync(): () => void {
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  const accept = (value: unknown) => {
    if (value && typeof value === "object") void receiveWalletTip(value as SwarmTransaction).catch(() => {});
  };
  let bc: BroadcastChannel | undefined;
  try { bc = new BroadcastChannel("swarm-wallet-tips"); bc.onmessage = e => accept(e.data); } catch { /* unavailable */ }
  void import("@/lib/p2p/swarmMesh.standalone").then(({ getSwarmMeshStandalone }) => {
    if (!stopped) unsubscribe = getSwarmMeshStandalone().onMessage("wallet-tips", (_peer, tx) => accept(tx));
  });
  const replay = async () => {
    const chain = getSwarmChain();
    await chain.whenReady();
    for (const tx of [...chain.getChain().flatMap(b => b.transactions), ...chain.getPendingTransactions()]) {
      if (tx.type === "wallet_tip" && !stopped) {
        await broadcastTip(tx).catch(() => {});
      }
    }
  };
  void replay().catch(() => {});
  const timer = window.setInterval(() => void replay().catch(() => {}), 30_000);
  return () => { stopped = true; bc?.close(); unsubscribe?.(); window.clearInterval(timer); };
}