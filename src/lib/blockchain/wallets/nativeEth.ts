/**
 * Native ETH on the SWARM wallet — the Ethereum twin of native MINTME custody.
 *
 * ETH sent from any Ethereum wallet to the member's cold-key receiving address
 * (the same address they use on MintMe) is credited to their native wallet once
 * it is 12 blocks deep. A balance-sync record, signed by the cold key, credits
 * the difference between what the address holds (plus what it has recorded
 * sending out) and what was already credited, so nothing is credited twice.
 * Credited ETH can be tipped or transferred through the mesh like MINTME, and
 * withdrawn back to any Ethereum address; the real gas used is debited.
 *
 * Gas spent by Ethereum token withdrawals comes from the same address. It only
 * lowers what the address holds, so it can delay crediting a later ETH deposit
 * but never credits ETH that is not there.
 */
import { formatUnits, getAddress, isAddress, parseUnits, verifyMessage, type FallbackProvider } from "ethers";
import type { SwarmTransaction } from "../types";
import { ethereumFallbackProvider } from "./ethereumRpc";
import { ETHEREUM_CHAIN_ID_DEC } from "./ethereumNetwork";

export const NATIVE_ETH_ASSET_ID = "native:ETH";
export const NATIVE_ETH_CUSTODY = "eth-native-custody-v1";
export const ETH_CONFIRMATIONS = 12;
const ADDRESS = /^0x[\da-f]{40}$/;
const USER = /^[a-f0-9]{16}$/;

export function ethReadProvider(): FallbackProvider {
  return ethereumFallbackProvider();
}

export function ethUnits(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive ETH amount");
  return parseUnits(amount.toFixed(18).replace(/\.?0+$/, ""), 18);
}

export function ethAmount(units: bigint): number {
  return Number(formatUnits(units, 18));
}

/** Exact wei of a native ETH record, or null when its amount and units disagree. */
export function nativeEthUnits(tx: SwarmTransaction): bigint | null {
  try {
    const raw = tx.meta?.amountUnits;
    if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
    const units = BigInt(raw);
    return tx.amount === ethAmount(units) ? units : null;
  } catch { return null; }
}

export function isNativeEthTip(tx: SwarmTransaction): boolean {
  return tx.type === "wallet_tip" && tx.meta?.assetId === NATIVE_ETH_ASSET_ID
    && tx.meta?.currency === "ETH" && nativeEthUnits(tx) !== null;
}

export function isNativeEthDeposit(tx: SwarmTransaction): boolean {
  return tx.type === "external_deposit" && tx.meta?.currency === "ETH" && tx.meta?.custody === NATIVE_ETH_CUSTODY;
}

export function isNativeEthWithdraw(tx: SwarmTransaction): boolean {
  return tx.type === "external_withdraw" && tx.meta?.currency === "ETH" && tx.meta?.custody === NATIVE_ETH_CUSTODY;
}

/** Any ETH custody record (balance sync or withdrawal) needs verified acceptance. */
export function isNativeEthCustody(tx: SwarmTransaction): boolean {
  return isNativeEthDeposit(tx) || isNativeEthWithdraw(tx);
}

/** Recorded inflow and outflow for one cold-key address on Ethereum. */
export function ethCustodyFlows(transactions: readonly SwarmTransaction[], address: string, skipId?: string) {
  const a = address.toLowerCase();
  let inflow = 0n, outflow = 0n;
  const seen = new Set<string>();
  for (const tx of transactions) {
    if (tx.id === skipId || seen.has(tx.id)) continue;
    seen.add(tx.id);
    if (String(tx.meta?.custodyAddress ?? "").toLowerCase() !== a) continue;
    const units = nativeEthUnits(tx);
    if (units === null) continue;
    if (isNativeEthDeposit(tx)) inflow += units;
    else if (isNativeEthWithdraw(tx)) outflow += units;
  }
  return { inflow, outflow };
}

/** A member's native ETH, in wei: custody deposits, minus withdrawals, plus or minus tips. */
export function nativeEthBalanceUnits(transactions: readonly SwarmTransaction[], userId: string): bigint {
  let balance = 0n;
  const seen = new Set<string>();
  for (const tx of transactions) {
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    const units = nativeEthUnits(tx);
    if (units === null) continue;
    if (isNativeEthDeposit(tx) && tx.to === userId) balance += units;
    if (isNativeEthWithdraw(tx) && tx.from === userId) balance -= units;
    if (isNativeEthTip(tx)) {
      if (tx.from === userId) balance -= units;
      if (tx.to === userId) balance += units;
    }
  }
  return balance;
}

export function ethSyncMessage(userId: string, address: string, cumulative: bigint, units: bigint): string {
  return `SWARM native ETH sync v1\n${userId}\n${address.toLowerCase()}\n${cumulative}\n${units}`;
}

export function ethWithdrawMessage(userId: string, address: string, txHash: string, units: bigint): string {
  return `SWARM native ETH withdraw v1\n${userId}\n${address.toLowerCase()}\n${txHash.toLowerCase()}\n${units}`;
}

/**
 * Recheck an ETH custody record. Ledger replay (`live` false) checks the
 * signature and running total; live acceptance also checks Ethereum itself.
 */
export async function verifyNativeEthCustody(tx: SwarmTransaction, ledger: readonly SwarmTransaction[] = [], live = false): Promise<boolean> {
  try {
    if (tx.fee !== 0 || (tx.chainId ?? "SWARM") !== "SWARM") return false;
    const units = nativeEthUnits(tx);
    const address = String(tx.meta?.custodyAddress ?? "").toLowerCase();
    if (units === null || !ADDRESS.test(address) || tx.publicKey.toLowerCase() !== address) return false;

    if (isNativeEthDeposit(tx)) {
      const cumulative = String(tx.meta?.cumulativeUnits ?? "");
      if (tx.meta?.mode !== "sync" || !/^[1-9]\d*$/.test(cumulative) || !USER.test(tx.to)) return false;
      if (tx.id !== `eth-sync:${address}:${cumulative}` || tx.from !== address) return false;
      if (verifyMessage(ethSyncMessage(tx.to, address, BigInt(cumulative), units), tx.signature).toLowerCase() !== address) return false;
      // A cold address cannot be rebound to another owner.
      if (ledger.some(t => isNativeEthDeposit(t) && String(t.meta?.custodyAddress).toLowerCase() === address && t.to !== tx.to)) return false;
      const flows = ethCustodyFlows(ledger, address, tx.id);
      if (flows.inflow + units !== BigInt(cumulative)) return false;
      if (!live) return true;
      const provider = ethReadProvider();
      try {
        const [network, held] = await Promise.all([provider.getNetwork(), provider.getBalance(address)]);
        return network.chainId === BigInt(ETHEREUM_CHAIN_ID_DEC) && flows.inflow + units <= held + flows.outflow;
      } finally { provider.destroy(); }
    }

    if (!isNativeEthWithdraw(tx)) return false;
    const hash = String(tx.meta?.txHash ?? "").toLowerCase();
    if (!/^0x[\da-f]{64}$/.test(hash) || !USER.test(tx.from) || tx.id !== `eth-withdraw:${hash}`) return false;
    if (verifyMessage(ethWithdrawMessage(tx.from, address, hash, units), tx.signature).toLowerCase() !== address) return false;
    if (!live) return true;
    const provider = ethReadProvider();
    try {
      const [network, receipt, transfer] = await Promise.all([
        provider.getNetwork(), provider.getTransactionReceipt(hash), provider.getTransaction(hash),
      ]);
      if (network.chainId !== BigInt(ETHEREUM_CHAIN_ID_DEC) || receipt?.status !== 1 || !transfer) return false;
      const gas = receipt.gasUsed * (receipt.gasPrice ?? transfer.gasPrice ?? 0n);
      return transfer.from.toLowerCase() === address && transfer.to?.toLowerCase() === tx.to.toLowerCase()
        && transfer.value + gas === units;
    } finally { provider.destroy(); }
  } catch { return false; }
}

async function chainLedger() {
  const { getSwarmChain } = await import("../chain");
  const chain = getSwarmChain();
  await chain.whenReady();
  return { chain, ledger: () => [...chain.getChain().flatMap(b => b.transactions), ...chain.getPendingTransactions()] };
}

async function broadcast(tx: SwarmTransaction): Promise<void> {
  window.dispatchEvent(new Event("blockchain-transaction"));
  try {
    const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
    getSwarmMeshStandalone().broadcast("wallet-tips", tx);
  } catch { /* app-wide wallet replay retries delivery */ }
}

/**
 * Credit ETH that arrived at the receiving address and is not yet recorded.
 * Returns the ETH credited (0 when nothing new). Needs the unlocked signing vault.
 */
export async function syncNativeEthDeposits(userId: string): Promise<number> {
  const { deriveColdKey, getColdKeyReceivingAddress } = await import("./coldKey");
  const address = (await getColdKeyReceivingAddress(userId)).toLowerCase();
  const { chain, ledger } = await chainLedger();
  const provider = ethReadProvider();
  let held: bigint;
  try {
    const [network, tip] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
    if (network.chainId !== BigInt(ETHEREUM_CHAIN_ID_DEC)) throw new Error("Could not reach the Ethereum network. Try again shortly.");
    const [settled, current] = await Promise.all([
      provider.getBalance(address, Math.max(0, tip - ETH_CONFIRMATIONS)), provider.getBalance(address),
    ]);
    // A recent outgoing transfer is not yet in the settled balance; never credit above either.
    held = settled < current ? settled : current;
  } finally { provider.destroy(); }
  const flows = ethCustodyFlows(ledger(), address);
  const credit = held + flows.outflow - flows.inflow;
  if (credit <= 0n) return 0;
  const { wallet, address: signer } = await deriveColdKey(userId);
  if (signer.toLowerCase() !== address) throw new Error("This receiving address does not match your unlocked wallet.");
  const cumulative = flows.inflow + credit;
  const at = Date.now();
  const tx: SwarmTransaction = {
    id: `eth-sync:${address}:${cumulative}`, type: "external_deposit", from: address, to: userId,
    amount: ethAmount(credit), chainId: "SWARM", timestamp: new Date(at).toISOString(),
    publicKey: address, signature: await wallet.signMessage(ethSyncMessage(userId, address, cumulative, credit)),
    nonce: at, fee: 0,
    meta: { currency: "ETH", custody: NATIVE_ETH_CUSTODY, custodyAddress: address, mode: "sync", network: "ethereum",
      cumulativeUnits: cumulative.toString(), amountUnits: credit.toString() },
  };
  if (!await chain.acceptNativeEthCustody(tx)) throw new Error("Ethereum could not confirm this deposit yet. Nothing was credited.");
  await broadcast(tx);
  return ethAmount(credit);
}

/** Send native ETH to any Ethereum address; the real gas used is debited with it. */
export async function withdrawNativeEth(p: { userId: string; to: string; amount: number }): Promise<string> {
  if (!isAddress(p.to)) throw new Error("Enter a valid Ethereum address (0x…).");
  const to = getAddress(p.to);
  const value = ethUnits(p.amount);
  const { deriveColdKey } = await import("./coldKey");
  const { wallet, address } = await deriveColdKey(p.userId);
  if (to.toLowerCase() === address.toLowerCase()) throw new Error("That is your own receiving address.");
  const { chain } = await chainLedger();
  const provider = ethReadProvider();
  try {
    const signer = wallet.connect(provider);
    const [held, fee] = await Promise.all([provider.getBalance(address), provider.getFeeData()]);
    const gasPrice = fee.gasPrice ?? 0n;
    // Room for gas at up to twice the current price; only what is really used is debited.
    const maxCost = value + 21000n * gasPrice * 2n;
    if (chain.getNativeEthBalanceUnits(p.userId) < maxCost) throw new Error("Not enough native ETH: the amount plus the Ethereum gas fee is needed.");
    if (held < maxCost) throw new Error("Your receiving address holds less ETH on Ethereum than this needs (tips you received are not on Ethereum). Try a smaller amount.");
    const sent = await signer.sendTransaction({ to, value, gasLimit: 21000n, gasPrice });
    const receipt = await sent.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error("Ethereum rejected the transfer. Nothing was debited.");
    const units = value + receipt.gasUsed * (receipt.gasPrice ?? gasPrice);
    const hash = sent.hash.toLowerCase();
    const at = Date.now();
    const tx: SwarmTransaction = {
      id: `eth-withdraw:${hash}`, type: "external_withdraw", from: p.userId, to: to.toLowerCase(),
      amount: ethAmount(units), chainId: "SWARM", timestamp: new Date(at).toISOString(),
      publicKey: address.toLowerCase(), signature: await wallet.signMessage(ethWithdrawMessage(p.userId, address, hash, units)),
      nonce: at, fee: 0,
      meta: { currency: "ETH", custody: NATIVE_ETH_CUSTODY, custodyAddress: address.toLowerCase(), network: "ethereum", txHash: hash, amountUnits: units.toString() },
    };
    const deadline = Date.now() + 120_000;
    while (!await chain.acceptNativeEthCustody(tx)) {
      if (Date.now() > deadline) throw new Error(`Sent on Ethereum (${hash}) but recording is delayed; it will retry when the wallet refreshes.`);
      await new Promise(r => setTimeout(r, 3000));
    }
    await broadcast(tx);
    return hash;
  } finally { provider.destroy(); }
}
