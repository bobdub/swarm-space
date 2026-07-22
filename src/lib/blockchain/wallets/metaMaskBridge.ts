/**
 * MetaMask bridge.
 *
 * Works with both the desktop extension (injected window.ethereum) and
 * mobile MetaMask via the SDK (deep-link / QR pairing).
 *
 * The app never touches private keys or seed phrases — MetaMask signs
 * everything in the user's own wallet.
 */

import {
  getMetaMaskProvider,
  getMetaMaskProviderSync,
  hasInjectedMetaMask,
  isMobileDevice,
  type Eip1193Provider,
} from "./metaMaskSdk";

async function getProvider(): Promise<Eip1193Provider | null> {
  return getMetaMaskProvider();
}

/**
 * True when a MetaMask provider is *reachable* — either the extension is
 * injected or we're on a device where the SDK can deep-link into the app.
 */
export function isMetaMaskAvailable(): boolean {
  if (hasInjectedMetaMask()) return true;
  // Mobile can always reach MetaMask via the SDK deep link.
  return isMobileDevice();
}

export interface MetaMaskConnection {
  address: string;
  chainId: string;
}

/** Prompts MetaMask for an account. Returns null if unavailable / declined. */
export async function connectMetaMask(): Promise<MetaMaskConnection | null> {
  const eth = await getProvider();
  if (!eth?.request) return null;
  try {
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    const chainId = (await eth.request({ method: "eth_chainId" })) as string;
    if (!accounts?.[0]) return null;
    return { address: accounts[0], chainId };
  } catch (err) {
    console.warn("[MetaMask] connect declined:", err);
    return null;
  }
}

/** Reads the current chain id without prompting. */
export async function getMetaMaskChainId(): Promise<string | null> {
  const eth = getMetaMaskProviderSync();
  if (!eth?.request) return null;
  try {
    return (await eth.request({ method: "eth_chainId" })) as string;
  } catch {
    return null;
  }
}

/** Returns the currently-authorized address, if any, without prompting. */
export async function getMetaMaskAccount(): Promise<string | null> {
  const eth = getMetaMaskProviderSync();
  if (!eth?.request) return null;
  try {
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

export function onMetaMaskChange(handler: () => void): () => void {
  const eth = getMetaMaskProviderSync();
  if (!eth?.on || !eth.removeListener) return () => {};
  eth.on("accountsChanged", handler);
  eth.on("chainChanged", handler);
  return () => {
    eth.removeListener?.("accountsChanged", handler);
    eth.removeListener?.("chainChanged", handler);
  };
}

/** Low-level EIP-1193 request against the current MetaMask provider. */
export async function requestMetaMask<T = unknown>(
  method: string,
  params?: unknown[] | Record<string, unknown>,
): Promise<T> {
  const eth = await getProvider();
  if (!eth?.request) throw new Error("MetaMask provider not available");
  return (await eth.request({ method, params })) as T;
}
