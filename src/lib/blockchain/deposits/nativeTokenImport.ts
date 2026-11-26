/**
 * Native custom-token import — no MetaMask required.
 *
 * The app reads ERC-20 metadata (symbol, decimals) straight from the token's
 * chain over public JSON-RPC nodes: MintMe's nodes, or public Ethereum mainnet
 * nodes. Adding a token here only places it on the owner's native watchlist;
 * it becomes spendable once a real transfer to the owner's cold-key receiving
 * address is confirmed on that chain and recorded on the SWARM ledger.
 */
import { Interface } from "ethers";
import { mintMeFallbackProvider } from "../wallets/mintmeRpc";
import { ethereumFallbackProvider } from "../wallets/ethereumRpc";
import { addCustomToken, isContractAddress, isValidSymbol, type CustomToken } from "./customTokens";
import { TOKEN_NETWORKS, type TokenNetworkId } from "./tokenNetworks";

const ERC20_META = new Interface([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/** One eth_call against a chain's public nodes. Injectable for tests. */
export type MintMeCall = (to: string, data: string) => Promise<string>;
export type TokenCall = MintMeCall;

export function publicMintMeCall(): MintMeCall {
  const provider = mintMeFallbackProvider();
  return async (to, data) => String(await provider.call({ to, data }));
}

export function publicTokenCall(network: TokenNetworkId = "mintme"): TokenCall {
  if (network === "mintme") return publicMintMeCall();
  const provider = ethereumFallbackProvider();
  return async (to, data) => String(await provider.call({ to, data }));
}

export interface PublicTokenMetadata {
  symbol: string | null;
  decimals: number | null;
}

/**
 * Read a token's symbol and decimals from its chain's public RPC nodes.
 * Null fields mean the contract did not answer — the user fills them in.
 */
export async function readTokenMetadataPublic(
  address: string,
  callArg?: TokenCall,
  network: TokenNetworkId = "mintme",
): Promise<PublicTokenMetadata> {
  if (!isContractAddress(address)) throw new Error("Enter a valid 0x contract address");
  const call = callArg ?? publicTokenCall(network);
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
 * Save a MintMe or Ethereum token to the native watchlist. No wallet approval is
 * needed — importing creates no balance and moves nothing; only a confirmed
 * on-chain transfer to the owner's receiving address records a balance.
 */
export function importCustomTokenFromMintMe(uid: string, details: Omit<CustomToken, "addedAt">): CustomToken {
  if (!uid) throw new Error("Sign in to add a token to your wallet.");
  if (
    !isContractAddress(details.address) ||
    !isValidSymbol(details.symbol) ||
    !Number.isInteger(details.decimals) ||
    details.decimals < 0 ||
    details.decimals > 36 ||
    (details.network !== undefined && !(details.network in TOKEN_NETWORKS))
  ) {
    throw new Error("Check the token address, symbol and decimals before adding it.");
  }
  return addCustomToken(uid, details);
}

/** Network-neutral name for {@link importCustomTokenFromMintMe}. */
export const importCustomToken = importCustomTokenFromMintMe;
