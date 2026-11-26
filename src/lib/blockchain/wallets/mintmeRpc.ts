/**
 * Read-only MintMe RPC providers, pinned to chain 24734.
 *
 * ethers v6 `FallbackProvider(providers, network, options)` takes the network
 * as its second argument, so passing `1` there (meant as a quorum) pinned the
 * provider to Ethereum mainnet. The first read then saw MintMe's chain id and
 * threw "network changed: 1 => 24734". Every MintMe reader goes through this
 * module so the network is always MintMe and never auto-detected. The shared
 * per-chain logic lives in `evmRpc`, which Ethereum readers use too.
 */
import type { FallbackProvider, JsonRpcProvider, Network } from "ethers";
import { MINTME_CHAIN_ID_DEC, MINTME_NETWORK } from "./mintmeNetwork";
import { evmEthersNetwork, evmFallbackProvider, evmJsonRpcProvider, type EvmChainConfig } from "./evmRpc";

export const MINTME_RPC_CHAIN: EvmChainConfig = { name: "mintme", chainId: MINTME_CHAIN_ID_DEC, rpcUrls: MINTME_NETWORK.rpcUrls };

export function mintMeEthersNetwork(): Network {
  return evmEthersNetwork(MINTME_RPC_CHAIN);
}

/** One public MintMe node with a static network: no detection round trip, no "network changed". */
export function mintMeJsonRpcProvider(url: string, network: Network = mintMeEthersNetwork()): JsonRpcProvider {
  return evmJsonRpcProvider(url, network);
}

/** Fallback across the public MintMe nodes, pinned to chain 24734. */
export function mintMeFallbackProvider(quorum = 1): FallbackProvider {
  return evmFallbackProvider(MINTME_RPC_CHAIN, quorum);
}
