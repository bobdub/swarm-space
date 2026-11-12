import type { SwarmCoin } from "./types";

export type EngravingTier = "basic" | "rare" | "legendary";
export const ENGRAVING_MB = 1_000_000;
export const ENGRAVING_CAPACITY_BYTES = 1024 ** 3;
export const ENGRAVING_MANUAL_MIN_BYTES = ENGRAVING_MB;
export const ENGRAVING_IDLE_MS = 60_000;

/** Boundaries belong to the higher tier; sub-5 MB manual seals are Basic. */
export function engravingTier(bytes: number): EngravingTier {
  return bytes >= 50 * ENGRAVING_MB ? "legendary" : bytes >= 10 * ENGRAVING_MB ? "rare" : "basic";
}

export function readSealTier(coin: Pick<SwarmCoin, "creatorProof" | "sealBytes">): EngravingTier {
  // Old seals did not record a tier and used the original large-container format.
  return coin.creatorProof?.tier ?? "legendary";
}

export function canSealEngraving(coin: SwarmCoin, mode: "manual" | "idle", now = Date.now()): boolean {
  const bytes = coin.sealBytes ?? 0;
  if (coin.status !== "wallet" || coin.locked || coin.vaultAddress || coin.kind === "media"
    || coin.fillState !== "filling" || !coin.payloadEntries?.length
    || !Number.isFinite(bytes) || bytes > ENGRAVING_CAPACITY_BYTES) return false;
  if (mode === "manual") return bytes >= ENGRAVING_MANUAL_MIN_BYTES;
  const loadedAt = Date.parse(coin.lastPayloadLoadAt ?? "");
  return bytes >= 5 * ENGRAVING_MB && Number.isFinite(loadedAt) && now - loadedAt >= ENGRAVING_IDLE_MS;
}