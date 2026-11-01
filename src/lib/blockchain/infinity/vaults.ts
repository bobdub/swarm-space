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

/** Precomputed `swarm-evm:<id>` addresses (same mapping as gateway/addressMap; a test keeps them in sync). */
const VAULT_ADDRESSES: Record<InfinityVaultId, string> = {
  "infinity:mintme": "0x5ea719c834e9d8d360520beea627a0e70553321c",
  "infinity:donations": "0x5c5a27b9f1c8aeabf65254971b910385d105d9ab",
  "infinity:market": "0x69ede939fe1ea53594ba38ff2e3843618f548d02",
};

export const infinityVaultEvmAddress = (vault: InfinityVaultId): string => VAULT_ADDRESSES[vault];

/** Ledger aliases: the old community pool is Infinity's MintMe vault. Nothing is rewritten. */
export function resolveInfinityVault(id: string): string {
  return id === LEGACY_COMMUNITY_POOL ? INFINITY_VAULTS.mintme : id;
}
