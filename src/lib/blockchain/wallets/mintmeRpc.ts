/**
 * Read-only MintMe RPC providers, pinned to chain 24734.
 *
 * ethers v6 `FallbackProvider(providers, network, options)` takes the network
 * as its second argument, so passing `1` there (meant as a quorum) pinned the
 * provider to Ethereum mainnet. The first read then saw MintMe's chain id and
 * threw "network changed: 1 => 24734". Every MintMe reader goes through this
 * module so the network is always MintMe and never auto-detected.
 */
import { FallbackProvider, JsonRpcProvider, Network } from "ethers";
import { MINTME_CHAIN_ID_DEC, MINTME_NETWORK } from "./mintmeNetwork";

export function mintMeEthersNetwork(): Network {
  return new Network("mintme", MINTME_CHAIN_ID_DEC);
}

/** One public MintMe node with a static network: no detection round trip, no "network changed". */
export function mintMeJsonRpcProvider(url: string, network: Network = mintMeEthersNetwork()): JsonRpcProvider {
  return new JsonRpcProvider(url, network, { staticNetwork: network });
}

/** Fallback across the public MintMe nodes, pinned to chain 24734. */
export function mintMeFallbackProvider(quorum = 1): FallbackProvider {
  const network = mintMeEthersNetwork();
  const urls = MINTME_NETWORK.rpcUrls;
  return new FallbackProvider(
    urls.map((url) => ({ provider: mintMeJsonRpcProvider(url, network), priority: 1, stallTimeout: 1500 })),
    network,
    { quorum: Math.max(1, Math.min(quorum, urls.length)) },
  );
}
