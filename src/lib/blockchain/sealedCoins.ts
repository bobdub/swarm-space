import { getAll } from "../store";
import type { SwarmCoin } from "./types";
import { readSealTier, type EngravingTier } from "./engravingTiers";

export interface SealedCoinRecord {
  coinId: string; tier: EngravingTier; bytes: number; entries: number; sealedAt: string; merkleRoot?: string;
}

export function sealedCoinHistory(coins: SwarmCoin[], userId: string): SealedCoinRecord[] {
  return coins
    .filter((c) => c.ownerId === userId && c.kind !== "media" && c.fillState === "sealed" && !!c.creatorProof)
    .map((c) => ({
      coinId: c.coinId, tier: readSealTier(c),
      bytes: c.creatorProof?.payloadBytes ?? c.sealBytes ?? 0,
      entries: c.payloadEntries?.length ?? 0,
      sealedAt: c.creatorProof?.sealedAt ?? c.sealedAt ?? "",
      merkleRoot: c.creatorProof?.merkleRoot,
    }))
    .sort((a, b) => Date.parse(b.sealedAt || "0") - Date.parse(a.sealedAt || "0"));
}

export async function getSealedCoinHistory(userId: string): Promise<SealedCoinRecord[]> {
  if (!userId) return [];
  return sealedCoinHistory(await getAll<SwarmCoin>("swarmCoins"), userId);
}
