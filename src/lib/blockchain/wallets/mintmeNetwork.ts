/**
 * MintMe.com Coin (chain id 24734) — canonical MetaMask chain descriptor.
 *
 * MintMe is a real, public EVM chain. The user's MetaMask account IS the
 * peer's vault — no custodian, no bridge signer, no cloud. Everything the
 * app does with MintMe is signed by the user's own MetaMask.
 */

import { requestMetaMask } from "./metaMaskBridge";

export const MINTME_CHAIN_ID_DEC = 24734;
export const MINTME_CHAIN_ID_HEX = "0x60ae"; // 24734

export const MINTME_NETWORK = {
  chainId: MINTME_CHAIN_ID_HEX,
  chainName: "MintMe.com Coin",
  nativeCurrency: { name: "MintMe.com Coin", symbol: "MINTME", decimals: 18 },
  rpcUrls: [
    "https://node1.mintme.com",
    "https://node.1000x.ch",
    "https://0xrpc.io/mint",
  ],
  blockExplorerUrls: ["https://www.mintme.com/explorer"],
} as const;

export function isMintMeChain(chainId: string | null | undefined): boolean {
  return !!chainId && chainId.toLowerCase() === MINTME_CHAIN_ID_HEX;
}

export async function addMintMeToMetaMask(): Promise<void> {
  await requestMetaMask("wallet_addEthereumChain", [MINTME_NETWORK]);
}

export async function switchToMintMeNetwork(): Promise<void> {
  try {
    await requestMetaMask("wallet_switchEthereumChain", [
      { chainId: MINTME_CHAIN_ID_HEX },
    ]);
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await addMintMeToMetaMask();
      return;
    }
    throw err;
  }
}