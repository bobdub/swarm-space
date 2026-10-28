import { getCurrentUser, getCachedPrivateKey } from "@/lib/auth";
import { getSwarmChain } from "../chain";
import { getColdKeyReceivingAddress } from "../wallets/coldKey";
import { signWalletTip } from "../wallets/tipSignature";
import { getMintMeCommunityVaultAddress } from "./communityCustody";
import { planMintMePayout } from "./payoutPolicy";
import { mintMeAmount, NATIVE_MINTME_ASSET_ID } from "../wallets/nativeMintmeLedger";
import type { SwarmTransaction } from "../types";

/** Authorized community identity only. Call with a verified network membership
 * snapshot, not the browser's neighbour count or advisory share receipts.
 * Deposited funds must already be accepted by native custody verification.
 */
export async function distributeNativeMintMe(batchId: string, recipientIds: readonly string[]): Promise<boolean> {
  const user = getCurrentUser();
  const key = await getCachedPrivateKey();
  if (!user || !key) throw new Error("Sign in to the community wallet to distribute MINTME.");
  const address = getMintMeCommunityVaultAddress();
  if (!address || (await getColdKeyReceivingAddress(user.id)).toLowerCase() !== address.toLowerCase()) {
    throw new Error("This account does not control the community wallet.");
  }
  if (!/^[\w-]{1,80}$/.test(batchId)) throw new Error("Invalid payout batch identifier");
  const recipients = [...new Set(recipientIds)].sort();
  if (recipients.some(id => !/^[a-f0-9]{16}$/.test(id) || id === user.id)) throw new Error("Invalid community payout recipient");
  const chain = getSwarmChain();
  await chain.whenReady();
  const history = [...chain.getChain().flatMap(b => b.transactions), ...chain.getPendingTransactions()];
  if (history.some(tx => tx.meta?.mintmePayoutBatch === batchId)) return true;
  const reserved = history.reduce((sum, tx) => sum + (tx.from === user.id && typeof tx.meta?.communityRetainedUnits === "string"
    ? BigInt(tx.meta.communityRetainedUnits) : 0n), 0n);
  const available = chain.getNativeMintMeBalanceUnits(user.id) - reserved;
  const plan = planMintMePayout(available, recipients);
  if (plan.status !== "ready") return false;
  const timestamp = new Date().toISOString();
  const transactions: SwarmTransaction[] = [];
  for (const [index, recipient] of plan.recipients.entries()) {
    transactions.push(await signWalletTip({
      id: `mintme-payout:${batchId}:${recipient}`, type: "wallet_tip", from: user.id, to: recipient,
      amount: mintMeAmount(plan.perPeerUnits), chainId: "SWARM", timestamp,
      nonce: Date.now() + index, fee: 0, signature: "", publicKey: user.publicKey,
      meta: { assetId: NATIVE_MINTME_ASSET_ID, ticker: "MINTME", currency: "MINTME",
        amountUnits: plan.perPeerUnits.toString(), mintmePayoutBatch: batchId,
        ...(index === 0 ? { communityRetainedUnits: plan.communityUnits.toString() } : {}) },
    }, key));
  }
  if (!await chain.acceptNativeMintMeBatch(transactions)) throw new Error("Community MINTME balance changed; retry the distribution.");
  window.dispatchEvent(new Event("blockchain-transaction"));
  const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
  for (const tx of transactions) getSwarmMeshStandalone().broadcast("wallet-tips", tx);
  return true;
}