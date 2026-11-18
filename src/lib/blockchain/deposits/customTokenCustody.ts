import { Contract, Interface, formatUnits, parseUnits, verifyMessage } from "ethers";
import type { SwarmTransaction } from "../types";
import { mintMeReadProvider } from "../wallets/nativeMintmeCustody";
import { MINTME_NETWORK } from "../wallets/mintmeNetwork";

export const CUSTOM_TOKEN_CUSTODY = "cold-token-sync-v1";
export const TOKEN_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

export function isCustomTokenSync(tx: SwarmTransaction): boolean {
  return tx.type === "external_deposit" && tx.meta?.custody === CUSTOM_TOKEN_CUSTODY;
}

/**
 * Exact token units of a ledger record. New records carry `amountUnits`; older ones only carry a
 * JS number, which can print as "1e-7" or hold more decimals than the token, so convert it safely.
 */
export function recordUnits(tx: SwarmTransaction, decimals: number): bigint {
  const raw = String(tx.meta?.amountUnits ?? "");
  if (/^[1-9]\d*$/.test(raw)) return BigInt(raw);
  const amount = Number(tx.amount);
  let text = String(amount);
  if (/e/i.test(text)) text = amount.toFixed(Math.min(decimals, 100));
  const [whole, fraction = ""] = text.split(".");
  const kept = fraction.slice(0, decimals);
  return parseUnits(kept ? `${whole}.${kept}` : whole, decimals);
}

/** A confirmed MintMe transfer matches a withdrawal record by exact units, or by the 8-decimal amount older records kept. */
function withdrawalMatches(tx: SwarmTransaction, sentUnits: bigint, decimals: number): boolean {
  const raw = String(tx.meta?.amountUnits ?? "");
  if (/^[1-9]\d*$/.test(raw)) return BigInt(raw) === sentUnits;
  return Math.round(Number(formatUnits(sentUnits, decimals)) * 1e8) / 1e8 === Number(tx.amount);
}

/** External custody only: native peer transfers do not alter MintMe ingress. */
export function customTokenCustodyFlows(ledger: readonly SwarmTransaction[], owner: string, address: string, contract: string, decimals: number) {
  let inflow = 0n, outflow = 0n;
  const seen = new Set<string>();
  for (const tx of ledger) {
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    if (String(tx.meta?.currency).toLowerCase() !== `mintme:${contract.toLowerCase()}`) continue;
    const cold = String(tx.meta?.custodyAddress ?? tx.meta?.coldKeyAddress ?? tx.meta?.address ?? "").toLowerCase();
    if (cold !== address.toLowerCase() || !(Number(tx.amount) > 0)) continue;
    const units = recordUnits(tx, decimals);
    if (tx.type === "external_deposit" && tx.to === owner) inflow += units;
    if (tx.type === "external_withdraw" && tx.from === owner) outflow += units;
  }
  return { inflow, outflow };
}

export function customTokenSyncMessage(owner: string, address: string, contract: string, decimals: number, cumulative: bigint, units: bigint) {
  return JSON.stringify([CUSTOM_TOKEN_CUSTODY, owner, address.toLowerCase(), contract.toLowerCase(), decimals, cumulative.toString(), units.toString()]);
}

/** Live checks use both settled and current holdings so recent withdrawals cannot be re-credited. */
export async function readCustomTokenCustody(address: string, contract: string, decimals: number, ledger: readonly SwarmTransaction[] = [], owner = ""): Promise<bigint> {
  const provider = mintMeReadProvider();
  try {
    const token = new Contract(contract, TOKEN_ABI, provider);
    const [network, tip, actualDecimals] = await Promise.all([provider.getNetwork(), provider.getBlockNumber(), token.decimals()]);
    if (network.chainId !== BigInt(MINTME_NETWORK.chainId) || Number(actualDecimals) !== decimals) throw new Error("MintMe token metadata could not be verified. Re-import this token and try again.");
    const [settled, current] = await Promise.all([
      token.balanceOf(address, { blockTag: Math.max(0, tip - 6) }) as Promise<bigint>,
      token.balanceOf(address) as Promise<bigint>,
    ]);
    let outflow = 0n;
    const seen = new Set<string>();
    const transfers = new Interface(["function transfer(address,uint256) returns (bool)"]);
    for (const tx of ledger) {
      if (seen.has(tx.id)) continue;
      seen.add(tx.id);
      if (tx.type !== "external_withdraw" || tx.from !== owner
        || String(tx.meta?.currency).toLowerCase() !== `mintme:${contract.toLowerCase()}`
        || String(tx.meta?.coldKeyAddress ?? tx.meta?.address).toLowerCase() !== address.toLowerCase()) continue;
      const hash = String(tx.meta?.txHash ?? tx.signature);
      const [receipt, sent] = await Promise.all([provider.getTransactionReceipt(hash), provider.getTransaction(hash)]);
      // A broadcast is not a settled outflow; credit it only at the same confirmation depth as holdings.
      if (receipt?.status !== 1 || receipt.blockNumber > tip - 6 || !sent
        || sent.from.toLowerCase() !== address.toLowerCase() || sent.to?.toLowerCase() !== contract.toLowerCase()) continue;
      const decoded = transfers.parseTransaction({ data: sent.data });
      if (decoded?.name === "transfer" && String(decoded.args[0]).toLowerCase() === tx.to.toLowerCase()
        && withdrawalMatches(tx, decoded.args[1], decimals)) outflow += decoded.args[1];
    }
    return (settled < current ? settled : current) + outflow;
  } finally { provider.destroy(); }
}

export async function verifyCustomTokenSync(tx: SwarmTransaction, ledger: readonly SwarmTransaction[], live = false): Promise<boolean> {
  try {
    const address = String(tx.meta?.custodyAddress ?? "").toLowerCase();
    const contract = String(tx.meta?.contract ?? "").toLowerCase();
    const decimals = Number(tx.meta?.decimals);
    const raw = String(tx.meta?.amountUnits ?? ""), total = String(tx.meta?.cumulativeUnits ?? "");
    if (!isCustomTokenSync(tx) || tx.fee !== 0 || (tx.chainId ?? "SWARM") !== "SWARM"
      || !tx.to || !/^0x[\da-f]{40}$/.test(address) || !/^0x[\da-f]{40}$/.test(contract)
      || !Number.isInteger(decimals) || decimals < 0 || decimals > 36
      || !/^[1-9]\d*$/.test(raw) || !/^[1-9]\d*$/.test(total)
      || tx.from !== address || tx.publicKey.toLowerCase() !== address
      || tx.meta?.currency !== `MINTME:${contract}`) return false;
    const units = BigInt(raw), cumulative = BigInt(total);
    if (Number(formatUnits(units, decimals)) !== tx.amount
      || tx.id !== `token-sync:${contract}:${address}:${cumulative}`
      || verifyMessage(customTokenSyncMessage(tx.to, address, contract, decimals, cumulative, units), tx.signature).toLowerCase() !== address) return false;
    // A cold address cannot be rebound to another owner by a second receipt.
    if (ledger.some(t => isCustomTokenSync(t) && t.meta?.custodyAddress === address && t.to !== tx.to)) return false;
    const flows = customTokenCustodyFlows(ledger, tx.to, address, contract, decimals);
    if (flows.inflow + units !== cumulative) return false;
    return !live || cumulative <= await readCustomTokenCustody(address, contract, decimals, ledger, tx.to);
  } catch { return false; }
}