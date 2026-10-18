/**
 * SWARM EVM network — canonical MetaMask chain descriptor.
 *
 * MetaMask validates RPC availability and chain ID when adding a network,
 * so registration requires a reachable public HTTPS SWARM RPC — either the
 * default URL or one advertised by a GroupWare Personal Server host.
 *
 * The chain id is chosen from the unassigned range at chainlist.org to
 * avoid collision with any known public chain.
 */

import { getExternalMetaMaskProvider } from "./metaMaskSdk";
import { validatePublicRpc } from "./publicRpcValidation";

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

/** A successful preflight proves reachability/chain ID, not full EVM compatibility. */
export function verifySwarmPublicRpc(rpcUrl: string = SWARM_EVM_NETWORK.rpcUrls[0]): Promise<void> {
  return validatePublicRpc(rpcUrl, SWARM_EVM_CHAIN_ID_HEX);
}

/** Ask MetaMask to add the SWARM network, optionally via a peer-hosted RPC. */
export async function addSwarmNetworkToMetaMask(rpcUrl?: string): Promise<void> {
  const url = rpcUrl ?? SWARM_EVM_NETWORK.rpcUrls[0];
  await verifySwarmPublicRpc(url);
  await requestWallet("wallet_addEthereumChain", [{ ...SWARM_EVM_NETWORK, rpcUrls: [url] }]);
}

/** Ask MetaMask to switch the active chain to SWARM (adds it if missing). */
export async function switchToSwarmNetwork(rpcUrl?: string): Promise<void> {
  await verifySwarmPublicRpc(rpcUrl);
  try {
    await requestWallet("wallet_switchEthereumChain", [
      { chainId: SWARM_EVM_CHAIN_ID_HEX },
    ]);
  } catch (err) {
    // 4902 = chain not added yet
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await addSwarmNetworkToMetaMask(rpcUrl);
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
