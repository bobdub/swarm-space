import { FallbackProvider, JsonRpcProvider, verifyMessage } from "ethers";
import { MINTME_NETWORK } from "./mintmeNetwork";
import { isNativeMintMeDeposit, mintMeCustodyMessage, nativeMintMeUnits } from "./nativeMintmeLedger";
import type { SwarmTransaction } from "../types";

/** Recheck actual MintMe receipt and custody-address authorization, never a
 * balance report or mining share. No secret is stored or requested here.
 */
export async function verifyNativeMintMeDeposit(tx: SwarmTransaction): Promise<boolean> {
  try {
    if (!isNativeMintMeDeposit(tx) || tx.fee !== 0 || (tx.chainId ?? "SWARM") !== "SWARM") return false;
    const units = nativeMintMeUnits(tx);
    const address = String(tx.meta?.custodyAddress ?? "").toLowerCase();
    const hash = String(tx.meta?.txHash ?? "").toLowerCase();
    if (units === null || !/^0x[\da-f]{40}$/.test(address) || !/^0x[\da-f]{64}$/.test(hash)) return false;
    if (!/^[a-f0-9]{16}$/.test(tx.to) || tx.from.toLowerCase() === address) return false;
    if (tx.id !== `mintme-custody:${hash}` || tx.publicKey.toLowerCase() !== address) return false;
    if (verifyMessage(mintMeCustodyMessage(tx.to, address, hash, units), tx.signature).toLowerCase() !== address) return false;
    const provider = new FallbackProvider(MINTME_NETWORK.rpcUrls.map(url => new JsonRpcProvider(url)), 1);
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