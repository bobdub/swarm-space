/**
 * Native custom-token import — no MetaMask required.
 *
 * The app reads ERC-20 metadata (symbol, decimals) straight from MintMe's
 * public JSON-RPC nodes, the same nodes the cold-key signer uses. Adding a
 * token here only places it on the owner's native watchlist; it becomes
 * spendable once a real MintMe transfer to the owner's cold-key receiving
 * address is confirmed and recorded on the SWARM ledger.
 */
import { FallbackProvider, Interface, JsonRpcProvider } from "ethers";
import { MINTME_NETWORK } from "../wallets/mintmeNetwork";
import { addCustomToken, isContractAddress, isValidSymbol, type CustomToken } from "./customTokens";

const ERC20_META = new Interface([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/** One eth_call against the public MintMe nodes. Injectable for tests. */
export type MintMeCall = (to: string, data: string) => Promise<string>;

export function publicMintMeCall(): MintMeCall {
  const provider = new FallbackProvider(
    MINTME_NETWORK.rpcUrls.map((url) => ({ provider: new JsonRpcProvider(url), priority: 1, stallTimeout: 1500 })),
    1,
  );
  return async (to, data) => String(await provider.call({ to, data }));
}

export interface PublicTokenMetadata {
  symbol: string | null;
  decimals: number | null;
}

/**
 * Read a MintMe token's symbol and decimals from the public RPC nodes.
 * Null fields mean the contract did not answer — the user fills them in.
 */
export async function readTokenMetadataPublic(
  address: string,
  call: MintMeCall = publicMintMeCall(),
): Promise<PublicTokenMetadata> {
  if (!isContractAddress(address)) throw new Error("Enter a valid 0x contract address");
  const to = address.trim();
  const [symbol, decimals] = await Promise.all([
    call(to, ERC20_META.encodeFunctionData("symbol"))
      .then((r) => String(ERC20_META.decodeFunctionResult("symbol", r)[0]) || null)
      .catch(() => null),
    call(to, ERC20_META.encodeFunctionData("decimals"))
      .then((r) => Number(ERC20_META.decodeFunctionResult("decimals", r)[0]))
      .catch(() => null),
  ]);
  return {
    symbol,
    decimals: decimals != null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : null,
  };
}

/**
 * Save a MintMe token to the native watchlist. No wallet approval is needed —
 * importing creates no balance and moves nothing; only a confirmed MintMe
 * transfer to the owner's receiving address records a balance.
 */
export function importCustomTokenFromMintMe(uid: string, details: Omit<CustomToken, "addedAt">): CustomToken {
  if (!uid) throw new Error("Sign in to add a token to your wallet.");
  if (
    !isContractAddress(details.address) ||
    !isValidSymbol(details.symbol) ||
    !Number.isInteger(details.decimals) ||
    details.decimals < 0 ||
    details.decimals > 36
  ) {
    throw new Error("Check the token address, symbol and decimals before adding it.");
  }
  return addCustomToken(uid, details);
}
