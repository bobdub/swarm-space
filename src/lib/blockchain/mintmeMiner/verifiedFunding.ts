import { FallbackProvider, JsonRpcProvider } from "ethers";
import { MINTME_NETWORK } from "../wallets/mintmeNetwork";
import type { MintMeFundingReceipt } from "./payoutAgreement";

export interface MintMeFundingReader {
  getNetwork(): Promise<{ chainId: bigint }>;
  getBlockNumber(): Promise<number>;
  getBlock(height: number): Promise<{ hash: string | null } | null>;
  getBalance(address: string, height: number): Promise<bigint>;
  getTransaction(hash: string): Promise<{ to: string | null; from: string; value: bigint; blockHash: string | null } | null>;
  getTransactionReceipt(hash: string): Promise<{ status: number | null; blockNumber: number; blockHash: string } | null>;
}

/** Receipt proofs establish funding, not allocation or external spending authority.
 * The caller supplies the independently configured vault, never the sender's claim.
 */
export async function verifyMintMeFunding(
  reader: MintMeFundingReader, receipts: readonly MintMeFundingReceipt[], vaultAddress: string,
  expectedVault: string, confirmations = 12,
): Promise<boolean> {
  try {
    const vault = vaultAddress.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(vault) || /^0x0{40}$/.test(vault)
      || vault !== expectedVault.toLowerCase() || !Number.isSafeInteger(confirmations) || confirmations < 1
      || !receipts.length || receipts.length > 1000) return false;
    const seen = new Set<string>();
    let total = 0n;
    for (const r of receipts) {
      if (!/^0x[a-f0-9]{64}$/.test(r.txHash) || seen.has(r.txHash) || !/^[1-9]\d{0,77}$/.test(r.amountUnits)) return false;
      seen.add(r.txHash); total += BigInt(r.amountUnits);
    }
    const [network, height] = await Promise.all([reader.getNetwork(), reader.getBlockNumber()]);
    if (network.chainId !== BigInt(MINTME_NETWORK.chainId) || !Number.isSafeInteger(height)) return false;
    const finalized = height - confirmations + 1;
    if (finalized < 0 || await reader.getBalance(vault, finalized) < total) return false;
    // Bounded, serial reads avoid flooding public RPC nodes with a peer's receipt list.
    for (const r of receipts) {
      const [receipt, transfer] = await Promise.all([reader.getTransactionReceipt(r.txHash), reader.getTransaction(r.txHash)]);
      if (!receipt || !transfer || receipt.status !== 1 || receipt.blockNumber > finalized
        || receipt.blockNumber < 0 || !Number.isSafeInteger(receipt.blockNumber)
        || transfer.to?.toLowerCase() !== vault || transfer.from.toLowerCase() === vault
        || transfer.value !== BigInt(r.amountUnits) || transfer.blockHash !== receipt.blockHash) return false;
      const canonical = await reader.getBlock(receipt.blockNumber);
      if (!canonical?.hash || canonical.hash !== receipt.blockHash) return false;
    }
    return true;
  } catch { return false; }
}

export async function verifyMintMeFundingOnChain(receipts: readonly MintMeFundingReceipt[], vault: string, expectedVault: string): Promise<boolean> {
  // Two independent public RPC responses are required; no MetaMask/session key involved.
  const provider = new FallbackProvider(MINTME_NETWORK.rpcUrls.map(url => new JsonRpcProvider(url)), undefined, { quorum: 2 });
  try { return await verifyMintMeFunding(provider, receipts, vault, expectedVault); }
  finally { provider.destroy(); }
}