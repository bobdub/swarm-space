/**
 * assetSizing — classify any prefab / minted asset into a single, glanceable
 * size tier so users (and NPCs) can predict what they're about to place.
 *
 * SCAFFOLD STAGE — pure derivation; consumed by the Builder Bar tile, the
 * Lab Mint preview, and the NPC `craft` drive.
 *
 *   tool       — small holdable (longest dim < 0.5 m, mass < 5 kg).
 *   block      — single building piece (≤ 3 m on any axis).
 *   structure  — traversable building (volume ≥ 8 m³ or ≥ 3 m height).
 *   nature     — biome-scale prop (tree, lake, rock, volcano).
 */

export type SizeTier = 'tool' | 'block' | 'structure' | 'nature';

export interface SizeInputs {
  width: number;
  depth: number;
  height: number;
  /** Optional mass in kg — sharpens tool vs block. */
  mass?: number;
  /** Optional explicit hint (e.g. nature seeds set this). */
  natureHint?: boolean;
}

/** Glyph + label for HUD badges. */
export const SIZE_TIER_META: Record<SizeTier, { label: string; glyph: string }> = {
  tool:      { label: 'Tool',      glyph: '✜' },
  block:     { label: 'Block',     glyph: '▦' },
  structure: { label: 'Structure', glyph: '⌂' },
  nature:    { label: 'Nature',    glyph: '✿' },
};

export function classifySize(s: SizeInputs): SizeTier {
  if (s.natureHint) return 'nature';
  const longest = Math.max(s.width, s.depth, s.height);
  const volume = s.width * s.depth * s.height;
  const mass = s.mass ?? Number.POSITIVE_INFINITY;
  if (longest < 0.5 && mass < 5) return 'tool';
  if (volume >= 8 || s.height >= 3) return 'structure';
  return 'block';
}