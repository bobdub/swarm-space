/**
 * External EVM networks that imported ERC-20 tokens can come from.
 *
 * A token's identity is its chain plus its contract — never its symbol, and
 * never the contract alone, since the same address can exist on two chains.
 * That identity is carried as a "token ref":
 *
 * - MintMe (chain 24734): the bare lowercase contract, `0xabc…`. This keeps
 *   every MintMe record written before Ethereum support valid unchanged.
 * - Ethereum (chain 1): `eth:0xabc…`.
 *
 * Ledger records name the asset by currency: `MINTME:0xabc…` or `ETHEREUM:0xabc…`.
 */
import { MINTME_CHAIN_ID_DEC, MINTME_NETWORK } from "../wallets/mintmeNetwork";
import { ETHEREUM_CHAIN_ID_DEC, ETHEREUM_NETWORK } from "../wallets/ethereumNetwork";

export type TokenNetworkId = "mintme" | "ethereum";
export const TOKEN_NETWORK_IDS: readonly TokenNetworkId[] = ["mintme", "ethereum"];

export interface TokenNetworkInfo {
  id: TokenNetworkId;
  label: string;
  chainId: number;
  /** Ledger currency prefix. */
  currencyPrefix: string;
  /** Token ref prefix; empty for MintMe so older records keep their identity. */
  refPrefix: string;
  /** Native coin that pays gas for withdrawals. */
  gasSymbol: string;
  explorerUrl: string;
  tokenUrl: (contract: string) => string;
  /** Blocks a deposit must be buried under before it is credited. */
  confirmations: number;
}

export const TOKEN_NETWORKS: Record<TokenNetworkId, TokenNetworkInfo> = {
  mintme: {
    id: "mintme", label: "MintMe", chainId: MINTME_CHAIN_ID_DEC, currencyPrefix: "MINTME", refPrefix: "",
    gasSymbol: MINTME_NETWORK.nativeCurrency.symbol, explorerUrl: MINTME_NETWORK.blockExplorerUrls[0],
    tokenUrl: () => MINTME_NETWORK.blockExplorerUrls[0], confirmations: 6,
  },
  ethereum: {
    id: "ethereum", label: "Ethereum", chainId: ETHEREUM_CHAIN_ID_DEC, currencyPrefix: "ETHEREUM", refPrefix: "eth:",
    gasSymbol: ETHEREUM_NETWORK.nativeCurrency.symbol, explorerUrl: ETHEREUM_NETWORK.blockExplorerUrls[0],
    tokenUrl: (contract) => `${ETHEREUM_NETWORK.blockExplorerUrls[0]}/token/${contract}`, confirmations: 12,
  },
};

const CONTRACT = /^0x[\da-f]{40}$/;

export function isTokenNetworkId(value: unknown): value is TokenNetworkId {
  return value === "mintme" || value === "ethereum";
}

/** Canonical ref for a contract on a network. */
export function tokenRef(contract: string, network: TokenNetworkId = "mintme"): string {
  return `${TOKEN_NETWORKS[network].refPrefix}${contract.trim().toLowerCase()}`;
}

/** Network and contract of a ref, or null when it is not a well formed, canonical one. */
export function parseTokenRef(ref: string): { network: TokenNetworkId; contract: string } | null {
  const r = String(ref ?? "").trim().toLowerCase();
  if (r.startsWith(TOKEN_NETWORKS.ethereum.refPrefix)) {
    const contract = r.slice(TOKEN_NETWORKS.ethereum.refPrefix.length);
    return CONTRACT.test(contract) ? { network: "ethereum", contract } : null;
  }
  return CONTRACT.test(r) ? { network: "mintme", contract: r } : null;
}

export function isTokenRef(ref: string): boolean {
  return parseTokenRef(ref) !== null;
}

export function tokenNetworkOf(ref: string): TokenNetworkId {
  return parseTokenRef(ref)?.network ?? "mintme";
}

export function tokenContractOf(ref: string): string {
  return parseTokenRef(ref)?.contract ?? String(ref ?? "").trim().toLowerCase();
}

/** Ledger currency of a token: `MINTME:0x…` or `ETHEREUM:0x…`. */
export function tokenCurrency(ref: string): string {
  const parsed = parseTokenRef(ref);
  if (!parsed) return `MINTME:${String(ref ?? "").trim().toLowerCase()}`;
  return `${TOKEN_NETWORKS[parsed.network].currencyPrefix}:${parsed.contract}`;
}

/** Token ref named by a ledger currency, or null when it is not an imported-token currency. */
export function tokenRefFromCurrency(currency: unknown): string | null {
  const c = String(currency ?? "").trim().toLowerCase();
  for (const network of TOKEN_NETWORK_IDS) {
    const prefix = `${TOKEN_NETWORKS[network].currencyPrefix.toLowerCase()}:`;
    if (c.startsWith(prefix)) {
      const contract = c.slice(prefix.length);
      return CONTRACT.test(contract) ? tokenRef(contract, network) : null;
    }
  }
  return null;
}
