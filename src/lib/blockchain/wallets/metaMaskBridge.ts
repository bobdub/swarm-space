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

type EthereumProvider = {
  isMetaMask?: boolean;
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function getProvider(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  return eth ?? null;
}

export function isMetaMaskAvailable(): boolean {
  return !!getProvider()?.isMetaMask;
}

export interface MetaMaskConnection {
  address: string;
  chainId: string;
}

/** Prompts MetaMask for an account. Returns null if unavailable / declined. */
export async function connectMetaMask(): Promise<MetaMaskConnection | null> {
  const eth = getProvider();
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
  const eth = getProvider();
  if (!eth?.request) return null;
  try {
    return (await eth.request({ method: "eth_chainId" })) as string;
  } catch {
    return null;
  }
}

/** Returns the currently-authorized address, if any, without prompting. */
export async function getMetaMaskAccount(): Promise<string | null> {
  const eth = getProvider();
  if (!eth?.request) return null;
  try {
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

export function onMetaMaskChange(handler: () => void): () => void {
  const eth = getProvider();
  if (!eth?.on || !eth.removeListener) return () => {};
  eth.on("accountsChanged", handler);
  eth.on("chainChanged", handler);
  return () => {
    eth.removeListener?.("accountsChanged", handler);
    eth.removeListener?.("chainChanged", handler);
  };
}
