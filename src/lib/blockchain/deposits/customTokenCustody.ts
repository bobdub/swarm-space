import { Contract, Interface, formatUnits, parseUnits, verifyMessage, type FallbackProvider } from "ethers";
import type { SwarmTransaction } from "../types";
import { mintMeReadProvider } from "../wallets/nativeMintmeCustody";
import { ethereumFallbackProvider } from "../wallets/ethereumRpc";
import { TOKEN_NETWORKS, parseTokenRef, tokenCurrency, tokenRef, type TokenNetworkId } from "./tokenNetworks";

export const CUSTOM_TOKEN_CUSTODY = "cold-token-sync-v1";
export const TOKEN_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

export function isCustomTokenSync(tx: SwarmTransaction): boolean {
  return tx.type === "external_deposit" && tx.meta?.custody === CUSTOM_TOKEN_CUSTODY;
}

/** Read-only provider for the chain a token lives on, pinned to that chain id. */
export function tokenReadProvider(network: TokenNetworkId): FallbackProvider {
  return network === "ethereum" ? ethereumFallbackProvider() : mintMeReadProvider();
}

/**
 * Token ref of a custody sync record: MintMe records (no `network`) keep the bare
 * contract; Ethereum records carry `network: "ethereum"`. Null for any other network.
 */
export function syncRecordRef(tx: SwarmTransaction): string | null {
  const network = tx.meta?.network ?? "mintme";
  if (network !== "mintme" && network !== "ethereum") return null;
  const contract = String(tx.meta?.contract ?? "").toLowerCase();
  return parseTokenRef(contract)?.network === "mintme" ? tokenRef(contract, network) : null;
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

/** External custody only: native peer transfers do not alter external ingress. `ref` is the token ref (chain + contract). */
export function customTokenCustodyFlows(ledger: readonly SwarmTransaction[], owner: string, address: string, ref: string, decimals: number) {
  const currency = tokenCurrency(ref).toLowerCase();
  let inflow = 0n, outflow = 0n;
  const seen = new Set<string>();
  for (const tx of ledger) {
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    if (String(tx.meta?.currency).toLowerCase() !== currency) continue;
    const cold = String(tx.meta?.custodyAddress ?? tx.meta?.coldKeyAddress ?? tx.meta?.address ?? "").toLowerCase();
    if (cold !== address.toLowerCase() || !(Number(tx.amount) > 0)) continue;
    const units = recordUnits(tx, decimals);
    if (tx.type === "external_deposit" && tx.to === owner) inflow += units;
    if (tx.type === "external_withdraw" && tx.from === owner) outflow += units;
  }
  return { inflow, outflow };
}

/** Signed by the cold key. `ref` is the bare contract on MintMe (the original format) and `eth:0x…` on Ethereum. */
export function customTokenSyncMessage(owner: string, address: string, ref: string, decimals: number, cumulative: bigint, units: bigint) {
  return JSON.stringify([CUSTOM_TOKEN_CUSTODY, owner, address.toLowerCase(), ref.toLowerCase(), decimals, cumulative.toString(), units.toString()]);
}

function refOrThrow(ref: string) {
  const parsed = parseTokenRef(ref);
  if (!parsed) throw new Error("Enter a valid 0x contract address");
  return { ...parsed, info: TOKEN_NETWORKS[parsed.network] };
}

/** The token's real decimals, read from the chain it lives on. */
export async function readTokenDecimalsOnChain(ref: string): Promise<number> {
  const { network: id, contract, info } = refOrThrow(ref);
  const provider = tokenReadProvider(id);
  try {
    const token = new Contract(contract, TOKEN_ABI, provider);
    const [network, decimals] = await Promise.all([provider.getNetwork(), token.decimals()]);
    if (network.chainId !== BigInt(info.chainId)) throw new Error(`Could not reach the ${info.label} network. Try again shortly.`);
    return Number(decimals);
  } finally { provider.destroy(); }
}
/** @deprecated MintMe-only name kept for older callers; accepts any token ref. */
export const readTokenDecimalsOnMintMe = readTokenDecimalsOnChain;

/** Live checks use both settled and current holdings so recent withdrawals cannot be re-credited. */
export async function readCustomTokenCustody(address: string, ref: string, decimals: number, ledger: readonly SwarmTransaction[] = [], owner = ""): Promise<bigint> {
  const { network: id, contract, info } = refOrThrow(ref);
  const currency = tokenCurrency(ref).toLowerCase();
  const provider = tokenReadProvider(id);
  try {
    const token = new Contract(contract, TOKEN_ABI, provider);
    const [network, tip, actualDecimals] = await Promise.all([provider.getNetwork(), provider.getBlockNumber(), token.decimals()]);
    if (network.chainId !== BigInt(info.chainId) || Number(actualDecimals) !== decimals) throw new Error(`${info.label} token metadata could not be verified. Re-import this token and try again.`);
    const depth = info.confirmations;
    const [settled, current] = await Promise.all([
      token.balanceOf(address, { blockTag: Math.max(0, tip - depth) }) as Promise<bigint>,
      token.balanceOf(address) as Promise<bigint>,
    ]);
    let outflow = 0n;
    const seen = new Set<string>();
    const transfers = new Interface(["function transfer(address,uint256) returns (bool)"]);
    for (const tx of ledger) {
      if (seen.has(tx.id)) continue;
      seen.add(tx.id);
      if (tx.type !== "external_withdraw" || tx.from !== owner
        || String(tx.meta?.currency).toLowerCase() !== currency
        || String(tx.meta?.coldKeyAddress ?? tx.meta?.address).toLowerCase() !== address.toLowerCase()) continue;
      const hash = String(tx.meta?.txHash ?? tx.signature);
      const [receipt, sent] = await Promise.all([provider.getTransactionReceipt(hash), provider.getTransaction(hash)]);
      // A broadcast is not a settled outflow; credit it only at the same confirmation depth as holdings.
      if (receipt?.status !== 1 || receipt.blockNumber > tip - depth || !sent
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
    const ref = syncRecordRef(tx);
    const decimals = Number(tx.meta?.decimals);
    const raw = String(tx.meta?.amountUnits ?? ""), total = String(tx.meta?.cumulativeUnits ?? "");
    if (!isCustomTokenSync(tx) || tx.fee !== 0 || (tx.chainId ?? "SWARM") !== "SWARM"
      || !tx.to || !/^0x[\da-f]{40}$/.test(address) || !ref
      || !Number.isInteger(decimals) || decimals < 0 || decimals > 36
      || !/^[1-9]\d*$/.test(raw) || !/^[1-9]\d*$/.test(total)
      || tx.from !== address || tx.publicKey.toLowerCase() !== address
      || tx.meta?.currency !== tokenCurrency(ref)) return false;
    const units = BigInt(raw), cumulative = BigInt(total);
    if (Number(formatUnits(units, decimals)) !== tx.amount
      || tx.id !== `token-sync:${ref}:${address}:${cumulative}`
      || verifyMessage(customTokenSyncMessage(tx.to, address, ref, decimals, cumulative, units), tx.signature).toLowerCase() !== address) return false;
    // A cold address cannot be rebound to another owner by a second receipt.
    if (ledger.some(t => isCustomTokenSync(t) && t.meta?.custodyAddress === address && t.to !== tx.to)) return false;
    const flows = customTokenCustodyFlows(ledger, tx.to, address, ref, decimals);
    if (flows.inflow + units !== cumulative) return false;
    return !live || cumulative <= await readCustomTokenCustody(address, ref, decimals, ledger, tx.to);
  } catch { return false; }
}