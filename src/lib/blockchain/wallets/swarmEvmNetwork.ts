/**
 * SWARM EVM network — canonical MetaMask chain descriptor.
 *
 * SWARM is a custom chain that will expose an EVM-compatible RPC. Until the
 * public RPC endpoint is live, the configured URL is a placeholder.
 * MetaMask validates RPC availability and chain ID when adding a network,
 * so registration may fail until a working SWARM RPC is available.
 *
 * The chain id is chosen from the unassigned range at chainlist.org to
 * avoid collision with any known public chain.
 */

import { getExternalMetaMaskProvider } from "./metaMaskSdk";

async function requestWallet(method: string, params: unknown[]): Promise<void> {
  const wallet = await getExternalMetaMaskProvider();
  if (!wallet?.request) throw new Error("MetaMask provider not available");
  await wallet.request({ method, params });
}

export const SWARM_EVM_CHAIN_ID_DEC = 74747;
export const SWARM_EVM_CHAIN_ID_HEX = "0x123fb"; // 74747

export const SWARM_EVM_NETWORK = {
  chainId: SWARM_EVM_CHAIN_ID_HEX,
  chainName: "Swarm-Space",
  nativeCurrency: {
    name: "SWARM",
    symbol: "SWARM",
    decimals: 18,
  },
  rpcUrls: ["https://rpc.swarm-space.lovable.app"],
  blockExplorerUrls: ["https://swarm-space.lovable.app/explorer"],
} as const;

/** Ask MetaMask to add the SWARM network to the user's wallet. */
export async function addSwarmNetworkToMetaMask(): Promise<void> {
  await requestWallet("wallet_addEthereumChain", [SWARM_EVM_NETWORK]);
}

/** Ask MetaMask to switch the active chain to SWARM (adds it if missing). */
export async function switchToSwarmNetwork(): Promise<void> {
  try {
    await requestWallet("wallet_switchEthereumChain", [
      { chainId: SWARM_EVM_CHAIN_ID_HEX },
    ]);
  } catch (err) {
    // 4902 = chain not added yet
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await addSwarmNetworkToMetaMask();
      await requestWallet("wallet_switchEthereumChain", [
        { chainId: SWARM_EVM_CHAIN_ID_HEX },
      ]);
      return;
    }
    throw err;
  }
}

export function isSwarmChain(chainId: string | null | undefined): boolean {
  return !!chainId && chainId.toLowerCase() === SWARM_EVM_CHAIN_ID_HEX;
}