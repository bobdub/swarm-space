/**
 * ETH deposits onto the SWARM chain — same self-custody witness model as MintMe:
 * MetaMask self-transfers on Ethereum mainnet, then signs a claim that the SWARM
 * chain records. Coins stay in the user's MetaMask.
 */
import { verifyMessage } from "ethers";
import { getSwarmChain } from "../chain";
import { generateTransactionId } from "../crypto";
import type { SwarmTransaction } from "../types";
import { getMetaMaskAccount, getMetaMaskChainId, requestMetaMask } from "../wallets/metaMaskBridge";
import { ethToWeiHex, weiHexToEth } from "../wallets/mintmeBridge";
import { getLinkedWallet, _allTransactionsForExternalLedger as allTransactions } from "../wallets/walletLink";

export const ETH = "ETH";
export const ETHEREUM_CHAIN_ID_HEX = "0x1";
const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

async function ensureEthereum(): Promise<void> {
  const chain = await getMetaMaskChainId();
  if (chain?.toLowerCase() !== ETHEREUM_CHAIN_ID_HEX) {
    await requestMetaMask("wallet_switchEthereumChain", [{ chainId: ETHEREUM_CHAIN_ID_HEX }]);
  }
}

export async function readEthBalance(address?: string): Promise<number | null> {
  const acct = address ?? (await getMetaMaskAccount());
  if (!acct) return null;
  try {
    await ensureEthereum();
    return weiHexToEth(String(await requestMetaMask<string>("eth_getBalance", [acct, "latest"])));
  } catch { return null; }
}

export function getChainEthBalance(swarmId: string): number {
  if (!swarmId) return 0;
  let total = 0;
  for (const tx of allTransactions()) {
    const meta = (tx.meta ?? {}) as Record<string, unknown>;
    if (meta.currency !== ETH) continue;
    if (tx.type === "external_deposit" && tx.to === swarmId) total += Number(tx.amount ?? 0);
    else if (tx.type === "external_withdraw" && tx.from === swarmId) total -= Number(tx.amount ?? 0);
  }
  return Math.max(0, round8(total));
}

export async function depositEth(params: { swarmId: string; amount: number }): Promise<SwarmTransaction> {
  const { swarmId, amount } = params;
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Enter an amount above zero");
  const link = getLinkedWallet(swarmId);
  if (!link) throw new Error("Link your MetaMask wallet to this Swarm identity first");
  const account = (await getMetaMaskAccount())?.toLowerCase();
  if (account !== link.address) throw new Error("MetaMask is on a different account than the linked wallet");
  await ensureEthereum();
  const before = await readEthBalance(link.address);
  if (before != null && before < amount) throw new Error(`MetaMask holds ${before.toFixed(6)} ETH — not enough for this deposit`);

  const txHash = String(await requestMetaMask<string>("eth_sendTransaction", [
    { from: link.address, to: link.address, value: ethToWeiHex(amount), chainId: ETHEREUM_CHAIN_ID_HEX },
  ]));
  const observed = await readEthBalance(link.address);
  const at = Date.now();
  const claim = { type: "deposit", currency: ETH, swarmId, address: link.address, amount, txHash, reportedBalance: observed ?? before ?? 0, at };
  const message = `Swarm-Space ETH record\n${JSON.stringify(claim, Object.keys(claim).sort())}`;
  const signature = String(await requestMetaMask<string>("personal_sign", [message, link.address]));
  if (verifyMessage(message, signature).toLowerCase() !== link.address) throw new Error("Signature does not match the connected wallet");

  const tx: SwarmTransaction = {
    id: generateTransactionId(), type: "external_deposit", from: link.address, to: swarmId,
    amount: round8(amount), timestamp: new Date(at).toISOString(), signature, publicKey: link.address,
    nonce: at, fee: 0, meta: { kind: "external_deposit", currency: ETH, address: link.address, txHash, claim, message, signature },
  };
  getSwarmChain().addTransaction(tx);
  try { window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } })); } catch { /* non-browser */ }
  return tx;
}
