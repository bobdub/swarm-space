/**
 * Ethereum mainnet (chain id 1) — public read and broadcast endpoints used for
 * imported ERC-20 tokens such as MTCG. No API keys: every URL is a free public
 * node, and the fallback provider moves on when one stalls or refuses.
 */
export const ETHEREUM_CHAIN_ID_DEC = 1;

export const ETHEREUM_NETWORK = {
  chainId: "0x1",
  chainName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://1rpc.io/eth",
    "https://eth.drpc.org",
    "https://cloudflare-eth.com",
  ],
  blockExplorerUrls: ["https://etherscan.io"],
} as const;
