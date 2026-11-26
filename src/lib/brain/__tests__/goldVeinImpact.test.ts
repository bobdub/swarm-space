/**
 * The Gold Vein is reachable work for a real Stone Pick through the shared
 * sculpting predicate (no mocks): a vein is chipped out of its host rock,
 * so it resists like rock even though gold weighs 19.3.
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

  it('a Stone Pick in a calm field cuts the vein', () => {
    expect(swing('tool_pick_stone', 'gold').cut).toBe(true);
  });

  it.each(['bedrock', 'coal', 'oil', 'mixed_minerals'])('a Stone Pick also cuts the %s above it', (id) => {
    expect(swing('tool_pick_stone', id).cut).toBe(true);
  });
});
