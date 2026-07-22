/**
 * SWARM EVM network — canonical MetaMask chain descriptor.
 *
 * SWARM is a custom chain that will expose an EVM-compatible RPC. Until the
 * public RPC endpoint is live, `SWARM_EVM_NETWORK.rpcUrls` uses a placeholder
 * that MetaMask will still accept for adding the network; on-chain calls
 * will fail with a clear "RPC unreachable" error, which is the correct
 * behavior for the pre-launch phase.
 *
 * The chain id is chosen from the unassigned range at chainlist.org to
 * avoid collision with any known public chain.
 */

import { requestMetaMask } from "./metaMaskBridge";

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
  await requestMetaMask("wallet_addEthereumChain", [SWARM_EVM_NETWORK]);
}

/** Ask MetaMask to switch the active chain to SWARM (adds it if missing). */
export async function switchToSwarmNetwork(): Promise<void> {
  try {
    await requestMetaMask("wallet_switchEthereumChain", [
      { chainId: SWARM_EVM_CHAIN_ID_HEX },
    ]);
  } catch (err) {
    // 4902 = chain not added yet
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await addSwarmNetworkToMetaMask();
      return;
    }
    throw err;
  }
}

export function isSwarmChain(chainId: string | null | undefined): boolean {
  return !!chainId && chainId.toLowerCase() === SWARM_EVM_CHAIN_ID_HEX;
}