import type { CreatorVault } from "./types";

/** Only proven forwarded community contributions stop requiring vault custody. */
export function creatorVaultBacking(vault: CreatorVault | null, held: number) {
  const required = vault
    ? vault.buybackReserve + vault.stabilityFloor + vault.creatorEarnings + vault.communityContributed - (vault.communityForwarded ?? 0)
    : 0;
  const forwarded = vault?.communityForwarded ?? 0;
  const valid = Number.isFinite(required) && required >= 0 && Number.isFinite(held) && held >= 0
    && Number.isFinite(forwarded) && forwarded >= 0 && forwarded <= (vault?.communityContributed ?? 0);
  const backed = valid && Math.round(held * 1e6) >= Math.round(required * 1e6);
  return {
    required,
    held,
    backed,
    shortfall: valid ? Math.max(0, Math.round((required - held) * 1e6) / 1e6) : 0,
    claimable: backed ? Math.max(0, vault?.creatorEarnings ?? 0) : 0,
  };
}