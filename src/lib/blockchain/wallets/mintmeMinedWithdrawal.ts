import { getSwarmChain } from "../chain";
import { INFINITY_VAULTS } from "../infinity/vaults";
import type { SwarmTransaction } from "../types";
import { MINTME_MINED_WITHDRAWAL_TYPE, mintMeAmount, mintMeUnits } from "./nativeMintmeLedger";

export function getMinedMintmeBalance(userId: string): number {
  return mintMeAmount(getSwarmChain().getNativeMintMeMinedUnits(userId));
}

/** Checks run against the mesh-synced ledger; on pass the mined share is debited and the
 * withdrawal is queued at Infinity's MintMe vault as "waiting for vault release". */
export async function requestMinedWithdrawal(p: { userId: string; destination: string; amount: number; connectedPeers: number }): Promise<SwarmTransaction> {
  if (p.connectedPeers < 1) throw new Error("Connect to a peer first — the network checks your mined balance.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(p.destination)) throw new Error("Enter a valid MintMe address (0x…).");
  const units = mintMeUnits(p.amount);
  if (units <= 0n) throw new Error("Enter an amount.");
  const chain = getSwarmChain();
  if (chain.getNativeMintMeMinedUnits(p.userId) < units) throw new Error("Not enough mined MINTME.");
  const tx: SwarmTransaction = {
    id: `mintme-mined-withdrawal-${crypto.randomUUID()}`,
    type: MINTME_MINED_WITHDRAWAL_TYPE as SwarmTransaction["type"],
    from: p.userId, to: INFINITY_VAULTS.mintme, amount: 0, timestamp: new Date().toISOString(),
    signature: "", publicKey: "", nonce: Date.now(), fee: 0,
    meta: { units: units.toString(), destination: p.destination, status: "awaiting-vault-release", peers: p.connectedPeers },
  } as SwarmTransaction;
  if (!await chain.acceptMintMeMinedWithdrawal(tx)) throw new Error("The network check did not pass.");
  try { window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } })); } catch { /* non-browser */ }
  return tx;
}
