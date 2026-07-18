/**
 * MetaMask bridge (stub).
 *
 * Phase 2 will use this to automate ETH escrow for the Coin Market. For now,
 * we only expose availability detection so the UI can show a "Connect wallet
 * (soon)" button without churn when the real implementation lands.
 *
 * The app never touches private keys or seed phrases — MetaMask signs
 * everything in the user's own extension.
 */

type EthereumProvider = { isMetaMask?: boolean; request?: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

export function isMetaMaskAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  return !!eth?.isMetaMask;
}

export interface MetaMaskConnection {
  address: string;
  chainId: string;
}

/** Placeholder — returns null until Phase 2. */
export async function connectMetaMask(): Promise<MetaMaskConnection | null> {
  return null;
}
