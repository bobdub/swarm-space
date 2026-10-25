/**
 * MintMe.com Coin (chain id 24734) — canonical MetaMask chain descriptor.
 *
 * MintMe is a real, public EVM chain. The user's MetaMask account IS the
 * peer's vault — no custodian, no bridge signer, no cloud. Everything the
 * app does with MintMe is signed by the user's own MetaMask.
 */

import { getMetaMaskChainId, requestMetaMask } from "./metaMaskBridge";
import { METAMASK_RESPONSE_TIMEOUT_MS, waitForMetaMask } from "./metaMaskRequestTimeout";

export const MINTME_CHAIN_ID_DEC = 24734;
export const MINTME_CHAIN_ID_HEX = `0x${MINTME_CHAIN_ID_DEC.toString(16)}`; // 0x609e

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

export function isMintMeChain(chainId: unknown): boolean {
  if (typeof chainId === "number") return chainId === MINTME_CHAIN_ID_DEC;
  if (typeof chainId !== "string" || !/^(0x[\da-f]+|\d+)$/i.test(chainId.trim())) return false;
  return Number(chainId.trim()) === MINTME_CHAIN_ID_DEC;
}

export class MintMeNetworkMissingError extends Error {
  constructor() {
    super("MetaMask reports MintMe is not added. You can add it, then try switching again.");
    this.name = "MintMeNetworkMissingError";
  }
}

export function readMintMeChainId(): Promise<string | null> {
  return waitForMetaMask(getMetaMaskChainId(), "MetaMask is taking longer than expected. Open MetaMask, unlock it if needed, and try again.");
}

/** A wallet acknowledgement alone is not proof that the active chain changed. */
async function waitForMintMe(readOnlyOnce = false): Promise<boolean> {
  const deadline = Date.now() + METAMASK_RESPONSE_TIMEOUT_MS;
  do {
    try {
      const chain = await waitForMetaMask(getMetaMaskChainId(), "Open MetaMask and try again.", Math.max(1, deadline - Date.now()));
      if (isMintMeChain(chain)) return true;
    } catch { /* retry read only */ }
    if (readOnlyOnce || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return false;
}

export async function addMintMeToMetaMask(): Promise<void> {
  if (isMintMeChain(await readMintMeChainId())) return;
  await waitForMetaMask(requestMetaMask("wallet_addEthereumChain", [MINTME_NETWORK]), "MetaMask did not answer the add-network request. Open MetaMask and try again.");
  // Adding a chain may leave MetaMask's approval UI transitioning. Continue to
  // token details without issuing a competing switch; transfers verify separately.
}

/** Import setup trusts wallet approval; actual transfers use the strict helper below. */
export async function switchOrAddMintMeNetwork(): Promise<void> {
  const current = await readMintMeChainId();
  if (isMintMeChain(current)) return;
  if (current == null) throw new Error("Could not read MetaMask's active network. Open MetaMask and try again.");
  try {
    await waitForMetaMask(requestMetaMask("wallet_switchEthereumChain", [
      { chainId: MINTME_CHAIN_ID_HEX },
    ]), "MetaMask did not answer the switch request. Open MetaMask and try again.");
    // The approval opens token details, not settlement. Do not poll a provider
    // still transitioning out of the approval dialog or issue a second switch.
  } catch (error) {
    if ((error as { code?: number } | null)?.code !== 4902) throw error;
    // Only a missing-network error warrants a read before offering addition.
    if (isMintMeChain(await readMintMeChainId())) return;
    await addMintMeToMetaMask();
  }
}

export async function switchToMintMeNetwork(): Promise<void> {
  const current = await readMintMeChainId();
  if (isMintMeChain(current)) return;
  if (current == null) throw new Error("Could not read MetaMask's active network. Open MetaMask and try again.");
  let switchError: unknown;
  try {
    await waitForMetaMask(requestMetaMask("wallet_switchEthereumChain", [
      { chainId: MINTME_CHAIN_ID_HEX },
    ]), "MetaMask did not answer the switch request. Open MetaMask and try again.");
  } catch (err) {
    switchError = err;
  }
  if (await waitForMintMe(switchError !== undefined)) return;
  if ((switchError as { code?: number } | undefined)?.code === 4902) throw new MintMeNetworkMissingError();
  if (switchError) throw switchError;
  throw new Error("MetaMask has not switched to MintMe. Check the network in MetaMask and try again.");
}