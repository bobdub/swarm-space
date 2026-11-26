/** Read-only Ethereum mainnet providers, pinned to chain 1 across public nodes. */
import type { FallbackProvider } from "ethers";
import { ETHEREUM_CHAIN_ID_DEC, ETHEREUM_NETWORK } from "./ethereumNetwork";
import { evmFallbackProvider, type EvmChainConfig } from "./evmRpc";

export const ETHEREUM_RPC_CHAIN: EvmChainConfig = { name: "mainnet", chainId: ETHEREUM_CHAIN_ID_DEC, rpcUrls: ETHEREUM_NETWORK.rpcUrls };

export function ethereumFallbackProvider(quorum = 1): FallbackProvider {
  return evmFallbackProvider(ETHEREUM_RPC_CHAIN, quorum);
}
