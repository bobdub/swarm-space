/**
 * MintMe peer bridge — no custodian, no server, no cloud.
 *
 * The user's MetaMask account IS the MintMe vault. This module just:
 *  1. Reads the live on-chain balance for the connected MetaMask address.
 *  2. Signs a real `eth_sendTransaction` on the MintMe chain to any peer.
 *
 * MetaMask signs everything with the user's own keys. The app never holds
 * or sees a private key.
 */

import { requestMetaMask, getMetaMaskAccount, getMetaMaskChainId } from "./metaMaskBridge";
import {
  MINTME_CHAIN_ID_HEX,
  isMintMeChain,
  switchToMintMeNetwork,
} from "./mintmeNetwork";

/** hex wei → decimal ether (safe for display; MintMe amounts fit in JS number). */
export function weiHexToEth(hex: string): number {
  try {
    const wei = BigInt(hex);
    const whole = Number(wei / 10n ** 18n);
    const frac = Number(wei % 10n ** 18n) / 1e18;
    return whole + frac;
  } catch { return 0; }
}

/** decimal ether → hex wei string (rounds down at 1e-18). */
export function ethToWeiHex(eth: number): string {
  if (!Number.isFinite(eth) || eth <= 0) return "0x0";
  // Split into whole + fractional to preserve 18-decimal precision.
  const whole = Math.floor(eth);
  const frac = eth - whole;
  const wei = BigInt(whole) * 10n ** 18n + BigInt(Math.floor(frac * 1e18));
  return "0x" + wei.toString(16);
}

/**
 * Read the connected MetaMask account's MintMe balance directly from the
 * chain via MetaMask's JSON-RPC. Auto-switches to the MintMe network first.
 */
export async function readMintMeBalance(address?: string): Promise<number | null> {
  const acct = address ?? (await getMetaMaskAccount());
  if (!acct) return null;
  const chain = await getMetaMaskChainId();
  if (!isMintMeChain(chain)) {
    try { await switchToMintMeNetwork(); } catch { return null; }
  }
  try {
    const hex = await requestMetaMask<string>("eth_getBalance", [acct, "latest"]);
    return weiHexToEth(String(hex));
  } catch {
    return null;
  }
}

/**
 * Send MintMe from the user's MetaMask directly to any recipient.
 * Returns the tx hash. MetaMask handles signing + broadcast.
 */
export async function sendMintMe(params: {
  to: string;
  amountEth: number;
}): Promise<string> {
  const { to, amountEth } = params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error("Invalid recipient address");
  if (!(amountEth > 0) || !Number.isFinite(amountEth)) throw new Error("Amount must be > 0");
  const from = await getMetaMaskAccount();
  if (!from) throw new Error("Connect MetaMask first");
  const chain = await getMetaMaskChainId();
  if (!isMintMeChain(chain)) await switchToMintMeNetwork();
  const value = ethToWeiHex(amountEth);
  const txHash = await requestMetaMask<string>("eth_sendTransaction", [
    { from, to, value, chainId: MINTME_CHAIN_ID_HEX },
  ]);
  return String(txHash);
}