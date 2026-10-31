import { sha256 } from "ethers";

/**
 * Infinity is the network. Its wallet holds the community pools as separate
 * vaults. Each vault id is fixed, and its public 0x address is derived the same
 * way as every native identity (`swarm-evm:<id>`), so every node computes the
 * same address with no setup and no key in code.
 */
export const INFINITY_ID = "infinity";
export const INFINITY_VAULTS = {
  mintme: "infinity:mintme",
  donations: "infinity:donations",
  market: "infinity:market",
} as const;
export type InfinityVaultId = typeof INFINITY_VAULTS[keyof typeof INFINITY_VAULTS];

/** Historical ledger id that now counts toward Infinity's MintMe vault. */
export const LEGACY_COMMUNITY_POOL = "community-pool";

/** Same mapping as gateway/addressMap.swarmIdToEvmAddress, but synchronous. */
export function infinityVaultEvmAddress(vault: InfinityVaultId): string {
  return "0x" + sha256("0x" + [...`swarm-evm:${vault}`].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")).slice(-40);
}

/** Ledger aliases: the old community pool is Infinity's MintMe vault. Nothing is rewritten. */
export function resolveInfinityVault(id: string): string {
  return id === LEGACY_COMMUNITY_POOL ? INFINITY_VAULTS.mintme : id;
}
