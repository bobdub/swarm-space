/** Direct MintMe ⇄ native wallet, no MetaMask: the user's own cold key
 * receives from any MintMe wallet and signs withdrawals; the network holds no key.
 */
import { getAddress, isAddress } from "ethers";
import { getSwarmChain } from "../chain";
import type { SwarmTransaction } from "../types";
import { deriveColdKey, getColdKeyReceivingAddress } from "./coldKey";
import { mintMeReadProvider } from "./nativeMintmeCustody";
import {
  custodyFlows, mintMeAmount, mintMeSyncMessage, mintMeUnits, mintMeWithdrawMessage, NATIVE_MINTME_CUSTODY,
} from "./nativeMintmeLedger";

const CONFIRMATIONS = 6;
const ledger = () => { const c = getSwarmChain(); return [...c.getChain().flatMap(b => b.transactions), ...c.getPendingTransactions()]; };

async function publish(tx: SwarmTransaction): Promise<void> {
  if (!await getSwarmChain().acceptNativeMintMeDeposit(tx)) throw new Error("The MintMe network could not confirm this yet. Nothing was credited or debited.");
  window.dispatchEvent(new Event("blockchain-transaction"));
  const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
  getSwarmMeshStandalone().broadcast("wallet-tips", tx);
}

/** Credit MINTME that arrived at the native receiving address and is not yet recorded.
 * Returns the amount credited (0 when nothing new). Needs the unlocked signing vault.
 */
export async function syncNativeMintMeDeposits(userId: string): Promise<number> {
  const address = (await getColdKeyReceivingAddress(userId)).toLowerCase();
  await getSwarmChain().whenReady();
  const provider = mintMeReadProvider();
  let held: bigint;
  try {
    const tip = await provider.getBlockNumber();
    held = await provider.getBalance(address, Math.max(0, tip - CONFIRMATIONS));
  } finally { provider.destroy(); }
  const flows = custodyFlows(ledger(), address);
  const credit = held + flows.outflow - flows.inflow;
  if (credit <= 0n) return 0;
  const { wallet, address: signer } = await deriveColdKey(userId);
  if (signer.toLowerCase() !== address) return 0;
  const cumulative = flows.synced + credit;
  const at = Date.now();
  const tx: SwarmTransaction = {
    id: `mintme-sync:${address}:${cumulative}`, type: "external_deposit", from: address, to: userId,
    amount: mintMeAmount(credit), chainId: "SWARM", timestamp: new Date(at).toISOString(),
    publicKey: address, signature: await wallet.signMessage(mintMeSyncMessage(userId, address, cumulative, credit)),
    nonce: at, fee: 0,
    meta: { currency: "MINTME", custody: NATIVE_MINTME_CUSTODY, custodyAddress: address, mode: "sync",
      cumulativeUnits: cumulative.toString(), amountUnits: credit.toString() },
  };
  await publish(tx);
  return mintMeAmount(credit);
}

/** Send MINTME from the native wallet to any MintMe address; gas is paid in MINTME and debited too. */
export async function withdrawNativeMintMe(p: { userId: string; to: string; amount: number }): Promise<string> {
  if (!isAddress(p.to)) throw new Error("Enter a valid MintMe address (0x…).");
  const to = getAddress(p.to);
  const value = mintMeUnits(p.amount);
  const { wallet, address } = await deriveColdKey(p.userId);
  if (to.toLowerCase() === address.toLowerCase()) throw new Error("That is your own receiving address.");
  const chain = getSwarmChain();
  await chain.whenReady();
  const provider = mintMeReadProvider();
  try {
    const signer = wallet.connect(provider);
    const [held, fee] = await Promise.all([provider.getBalance(address), provider.getFeeData()]);
    const gasPrice = fee.gasPrice ?? 0n;
    const maxCost = value + 21000n * gasPrice;
    if (chain.getNativeMintMeBalanceUnits(p.userId) < maxCost) throw new Error("Not enough native MINTME to cover the amount plus the small MintMe network fee.");
    if (held < maxCost) throw new Error("Your MintMe receiving address holds less than this on MintMe (network rewards and tips are credits that are not on MintMe yet). Try a smaller amount.");
    const sent = await signer.sendTransaction({ to, value, gasLimit: 21000n, gasPrice });
    const receipt = await sent.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error("MintMe rejected the transfer. Nothing was debited.");
    const units = value + receipt.gasUsed * (receipt.gasPrice ?? gasPrice);
    const hash = sent.hash.toLowerCase();
    const at = Date.now();
    const tx: SwarmTransaction = {
      id: `mintme-withdraw:${hash}`, type: "external_withdraw", from: p.userId, to: to.toLowerCase(),
      amount: mintMeAmount(units), chainId: "SWARM", timestamp: new Date(at).toISOString(),
      publicKey: address.toLowerCase(),
      signature: await wallet.signMessage(mintMeWithdrawMessage(p.userId, address, hash, units)),
      nonce: at, fee: 0,
      meta: { currency: "MINTME", custody: NATIVE_MINTME_CUSTODY, custodyAddress: address.toLowerCase(), txHash: hash, amountUnits: units.toString() },
    };
    const deadline = Date.now() + 120_000;
    while (!await chain.acceptNativeMintMeDeposit(tx)) {
      if (Date.now() > deadline) throw new Error(`Sent on MintMe (${hash}) but recording is delayed; it will retry when the wallet refreshes.`);
      await new Promise(r => setTimeout(r, 3000));
    }
    window.dispatchEvent(new Event("blockchain-transaction"));
    const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
    getSwarmMeshStandalone().broadcast("wallet-tips", tx);
    return hash;
  } finally { provider.destroy(); }
}
