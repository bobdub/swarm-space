/**
 * The Gold Vein through the shared sculpting predicate (no mocks): a Stone
 * Pick bounces off gold's full density, while the Prospector's Pick chips
 * the ore out of its host rock and cuts it.
 */
import { describe, expect, it } from 'vitest';
import { applyImpact } from '@/lib/brain/sculpting';
import { EARTH_SHELLS } from '@/lib/brain/earthShells';
import { getToolAny } from '@/lib/brain/toolCatalog';
import { playerSwingEnergy } from '@/lib/world/swingEnergy';

const gold = EARTH_SHELLS.find((s) => s.id === 'gold')!;

function swing(toolId: string, shellId: string) {
  const tool = getToolAny(toolId)!;
  const shell = EARTH_SHELLS.find((s) => s.id === shellId)!;
  return applyImpact({
    tool,
    swingEnergy: playerSwingEnergy(tool.mass, 0),
    curvatureLoad: 0,
    target: { kind: 'shell', shell, rFrac: (shell.rInnerFrac + shell.rOuterFrac) / 2, cellKey: 'c' },
  });
}

describe('Gold Vein', () => {
  it('keeps the real density of gold', () => {
    expect(gold.density).toBe(19.3);
  });

  it('a Stone Pick in a calm field cannot cut the vein', () => {
    expect(swing('tool_pick_stone', 'gold').cut).toBe(false);
  });

  it("the Prospector's Pick in a calm field cuts the vein", () => {
    expect(getToolAny('tool_pick_prospector')?.oreVeins).toBe(true);
    expect(swing('tool_pick_prospector', 'gold').cut).toBe(true);
  });

  it.each(['grass', 'soil', 'dirt', 'mixed_earth', 'bedrock', 'coal', 'oil', 'mixed_minerals'])(
    "the Prospector's Pick also cuts the %s on the way down", (id) => {
      expect(swing('tool_pick_prospector', id).cut).toBe(true);
    });

  it("the Prospector's Pick still cannot cut the platinum below", () => {
    expect(swing('tool_pick_prospector', 'platinum').cut).toBe(false);
  });
});
