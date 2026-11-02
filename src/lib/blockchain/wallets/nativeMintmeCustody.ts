import { FallbackProvider, JsonRpcProvider, verifyMessage } from "ethers";
import { MINTME_NETWORK } from "./mintmeNetwork";
import {
  custodyFlows, isNativeMintMeDeposit, isNativeMintMeWithdraw, mintMeCustodyMessage, mintMeSyncMessage,
  mintMeWithdrawMessage, nativeMintMeUnits,
} from "./nativeMintmeLedger";
import type { SwarmTransaction } from "../types";

export function mintMeReadProvider(): FallbackProvider {
  return new FallbackProvider(
    MINTME_NETWORK.rpcUrls.map(url => ({ provider: new JsonRpcProvider(url), priority: 1, stallTimeout: 1500 })), 1,
  );
}

/** Recheck MintMe custody records. Hash deposits and withdrawals are rechecked
 * against their on-chain transaction. Balance syncs (direct sends from any
 * MintMe wallet, no MetaMask) are checked live against the cold address balance:
 * everything ever credited to that address must not exceed what it holds plus
 * what it has recorded sending out. Ledger replay (`live` false) checks the
 * signature and running total only, because past balances are not queryable.
 */
export async function verifyNativeMintMeDeposit(
  tx: SwarmTransaction, ledger: readonly SwarmTransaction[] = [], live = false,
): Promise<boolean> {
  try {
    if (tx.fee !== 0 || (tx.chainId ?? "SWARM") !== "SWARM") return false;
    const units = nativeMintMeUnits(tx);
    const address = String(tx.meta?.custodyAddress ?? "").toLowerCase();
    if (units === null || !/^0x[\da-f]{40}$/.test(address) || tx.publicKey.toLowerCase() !== address) return false;

    if (isNativeMintMeDeposit(tx) && tx.meta?.mode === "sync") {
      const cumulative = String(tx.meta?.cumulativeUnits ?? "");
      if (!/^[1-9]\d*$/.test(cumulative) || !/^[a-f0-9]{16}$/.test(tx.to)) return false;
      if (tx.id !== `mintme-sync:${address}:${cumulative}` || tx.from !== address) return false;
      if (verifyMessage(mintMeSyncMessage(tx.to, address, BigInt(cumulative), units), tx.signature).toLowerCase() !== address) return false;
      const flows = custodyFlows(ledger, address, tx.id);
      if (flows.synced + units !== BigInt(cumulative)) return false;
      if (!live) return true;
      const provider = mintMeReadProvider();
      try {
        const [network, held] = await Promise.all([provider.getNetwork(), provider.getBalance(address)]);
        return network.chainId === BigInt(MINTME_NETWORK.chainId) && flows.inflow + units <= held + flows.outflow;
      } finally { provider.destroy(); }
    }

    const hash = String(tx.meta?.txHash ?? "").toLowerCase();
    if (!/^0x[\da-f]{64}$/.test(hash)) return false;

    if (isNativeMintMeWithdraw(tx)) {
      if (!/^[a-f0-9]{16}$/.test(tx.from) || tx.id !== `mintme-withdraw:${hash}`) return false;
      if (verifyMessage(mintMeWithdrawMessage(tx.from, address, hash, units), tx.signature).toLowerCase() !== address) return false;
      if (!live) return true;
      const provider = mintMeReadProvider();
      try {
        const [network, receipt, transfer] = await Promise.all([
          provider.getNetwork(), provider.getTransactionReceipt(hash), provider.getTransaction(hash),
        ]);
        if (network.chainId !== BigInt(MINTME_NETWORK.chainId) || receipt?.status !== 1 || !transfer) return false;
        const gas = receipt.gasUsed * (receipt.gasPrice ?? transfer.gasPrice ?? 0n);
        return transfer.from.toLowerCase() === address && transfer.to?.toLowerCase() === tx.to.toLowerCase()
          && transfer.value + gas === units;
      } finally { provider.destroy(); }
    }

    if (!isNativeMintMeDeposit(tx)) return false;
    if (!/^[a-f0-9]{16}$/.test(tx.to) || tx.from.toLowerCase() === address) return false;
    if (tx.id !== `mintme-custody:${hash}`) return false;
    if (verifyMessage(mintMeCustodyMessage(tx.to, address, hash, units), tx.signature).toLowerCase() !== address) return false;
    if (!live) return true;
    const provider = mintMeReadProvider();
    try {
      const [network, receipt, transfer] = await Promise.all([
        provider.getNetwork(), provider.getTransactionReceipt(hash), provider.getTransaction(hash),
      ]);
      return network.chainId === BigInt(MINTME_NETWORK.chainId) && receipt?.status === 1
        && transfer?.to?.toLowerCase() === address && transfer.from.toLowerCase() === tx.from.toLowerCase()
        && transfer.value === units && transfer.from.toLowerCase() !== address;
    } finally { provider.destroy(); }
  } catch { return false; }
}
