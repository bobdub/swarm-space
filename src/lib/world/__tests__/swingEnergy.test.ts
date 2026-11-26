/**
 * Real tools against the real cut predicate at a player's swing energy.
 * Before the fix every player swing was ~0.2 energy and nothing could be
 * cut in play — trees never fell.
 */
import { describe, expect, it } from 'vitest';
import { applyImpact } from '@/lib/brain/sculpting';
import { getToolAny } from '@/lib/brain/toolCatalog';
import { EARTH_SHELLS } from '@/lib/brain/earthShells';
import { playerSwingEnergy } from '@/lib/world/swingEnergy';

const axe = getToolAny('tool_axe_stone')!;
const pick = getToolAny('tool_pick_stone')!;
const shovel = getToolAny('tool_shovel_stone')!;
const shell = (id: string) => EARTH_SHELLS.find((s) => s.id === id)!;
const block = { id: 'b', bodyId: 'b', kind: 'tree', meta: {} } as never;

// Typical field readings from a live swing probe.
const INTENSITY = 2e-5;
const CURVATURE = 0.006;

function hitBlock(tool: typeof axe, bondTerm: number) {
  return applyImpact({
    tool,
    swingEnergy: playerSwingEnergy(tool.mass, INTENSITY),
    curvatureLoad: CURVATURE,
    target: { kind: 'block', block, bondTerm },
  });
}

function dig(tool: typeof axe, id: string) {
  return applyImpact({
    tool,
    swingEnergy: playerSwingEnergy(tool.mass, INTENSITY),
    curvatureLoad: CURVATURE,
    target: { kind: 'shell', shell: shell(id), rFrac: 1, cellKey: 'c' },
  });
}

describe('player swing energy', () => {
  it('a stone axe cuts a tree', () => {
    expect(hitBlock(axe, 0.42).cut).toBe(true);
  });

  it('a stone pick chips rock', () => {
    expect(hitBlock(pick, 0.88).cut).toBe(true);
  });

  it('a shovel breaks grass and soil', () => {
    expect(dig(shovel, 'grass').cut).toBe(true);
    expect(dig(shovel, 'soil').cut).toBe(true);
  });

  it('hard shells still refuse', () => {
    // The Gold Vein is pick work (chipped from host rock); platinum below it is not.
    expect(dig(pick, 'gold').cut).toBe(true);
    expect(dig(pick, 'platinum').cut).toBe(false);
    expect(dig(pick, 'diamond_upper').cut).toBe(false);
    expect(dig(pick, 'lava').cut).toBe(false);
  });

  it('the old formula could never cut a tree (regression guard)', () => {
    const old = Math.max(0.2, axe.mass * (0.3 + INTENSITY * 8));
    const res = applyImpact({ tool: axe, swingEnergy: old, curvatureLoad: CURVATURE, target: { kind: 'block', block, bondTerm: 0.42 } });
    expect(res.cut).toBe(false);
  });
});
