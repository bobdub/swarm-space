/**
 * Read-only EVM RPC providers, each pinned to one chain id.
 *
 * ethers v6 `FallbackProvider(providers, network, options)` takes the network
 * as its second argument; anything else there (such as a quorum number) pins
 * the wrong chain and the first read throws "network changed". Every reader of
 * an external EVM chain goes through this helper so the network is always the
 * one asked for and never auto-detected.
 */
import { FallbackProvider, JsonRpcProvider, Network } from "ethers";

export interface EvmChainConfig {
  /** ethers network name, e.g. "mintme" or "mainnet". */
  name: string;
  chainId: number;
  rpcUrls: readonly string[];
}

export function evmEthersNetwork(chain: EvmChainConfig): Network {
  return new Network(chain.name, chain.chainId);
}

/** One public node with a static network: no detection round trip, no "network changed". */
export function evmJsonRpcProvider(url: string, network: Network): JsonRpcProvider {
  return new JsonRpcProvider(url, network, { staticNetwork: network });
}

/** Fallback across a chain's public nodes, pinned to its chain id. */
export function evmFallbackProvider(chain: EvmChainConfig, quorum = 1): FallbackProvider {
  const network = evmEthersNetwork(chain);
  const urls = chain.rpcUrls;
  return new FallbackProvider(
    urls.map((url) => ({ provider: evmJsonRpcProvider(url, network), priority: 1, stallTimeout: 1500 })),
    network,
    { quorum: Math.max(1, Math.min(quorum, urls.length)) },
  );
}
