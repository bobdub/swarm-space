/** Native MINTME custody deposits and historical external-wallet records.
 * Native SWARM transfers move accepted custody claims; external MintMe
 * transfers remain separate and require custody signing authority.
 */

import { getSwarmChain } from "../chain";
import type { SwarmTransaction } from "../types";
import { _allTransactionsForExternalLedger as allTransactions } from "../wallets/walletLink";
import { mintMeAmount, mintMeCustodyMessage, NATIVE_MINTME_CUSTODY } from "../wallets/nativeMintmeLedger";
import { deriveColdKey } from "../wallets/coldKey";

export const MINTME = "MINTME";

export interface ExternalEntry {
  id: string;
  kind: "deposit" | "withdraw" | "reconcile";
  amount: number;
  txHash?: string;
  at: string;
}

export interface MintMeLedger {
  /** Recorded on the SWARM chain for this identity. */
  recorded: number;
  entries: ExternalEntry[];
  lastEntryAt: string | null;
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

function metaOf(tx: SwarmTransaction): Record<string, unknown> {
  return (tx.meta ?? {}) as Record<string, unknown>;
}

/** Walk the chain and rebuild this identity's MINTME position. */
export function getMintMeLedger(swarmId: string): MintMeLedger {
  const entries: ExternalEntry[] = [];
  let recorded = 0;
  if (!swarmId) return { recorded: 0, entries, lastEntryAt: null };

  for (const tx of allTransactions()) {
    const meta = metaOf(tx);
    if (meta.currency !== MINTME) continue;
    const mine = tx.to === swarmId || tx.from === swarmId;
    if (!mine) continue;
    const amount = Number(tx.amount ?? 0);

    if (tx.type === "external_deposit" && tx.to === swarmId) {
      recorded += amount;
      entries.push({ id: tx.id, kind: "deposit", amount, txHash: String(meta.txHash ?? ""), at: tx.timestamp });
    } else if (tx.type === "external_withdraw" && tx.from === swarmId) {
      recorded -= amount;
      entries.push({ id: tx.id, kind: "withdraw", amount, txHash: String(meta.txHash ?? ""), at: tx.timestamp });
    } else if (tx.type === "external_reconcile" && tx.to === swarmId) {
      const delta = Number(meta.delta ?? 0);
      recorded += delta;
      entries.push({ id: tx.id, kind: "reconcile", amount: delta, at: tx.timestamp });
    }
  }

  recorded = Math.max(0, round8(recorded));
  return {
    recorded,
    entries: entries.reverse(),
    lastEntryAt: entries[0]?.at ?? null,
  };
}

export function getChainMintmeBalance(swarmId: string): number {
  return mintMeAmount(getSwarmChain().getNativeMintMeBalanceUnits(swarmId));
}

/** Also accepts a real pool receipt into the configured community identity.
 * The same hash is the deposit id on every device, preventing duplicate credit.
 */
export async function recordNativeMintMeCustody(params: {
  swarmId: string; from: string; txHash: string; amountUnits: bigint;
}): Promise<SwarmTransaction> {
  const { swarmId, from, amountUnits } = params;
  const txHash = params.txHash.toLowerCase();
  const { wallet, address } = await deriveColdKey(swarmId);
  const at = Date.now();
  const tx: SwarmTransaction = {
    id: `mintme-custody:${txHash}`, type: "external_deposit", from, to: swarmId,
    amount: mintMeAmount(amountUnits), chainId: "SWARM", timestamp: new Date(at).toISOString(),
    publicKey: address, signature: await wallet.signMessage(mintMeCustodyMessage(swarmId, address, txHash, amountUnits)),
    nonce: at, fee: 0,
    meta: { currency: MINTME, custody: NATIVE_MINTME_CUSTODY, custodyAddress: address,
      txHash, amountUnits: amountUnits.toString() },
  };
  const deadline = Date.now() + 300_000;
  while (!await getSwarmChain().acceptNativeMintMeDeposit(tx)) {
    if (Date.now() >= deadline) throw new Error(`MintMe has not confirmed custody yet. No native funds were credited. Retry recording ${txHash} after confirmation.`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  window.dispatchEvent(new Event("blockchain-transaction"));
  const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
  getSwarmMeshStandalone().broadcast("wallet-tips", tx);
  return tx;
}

