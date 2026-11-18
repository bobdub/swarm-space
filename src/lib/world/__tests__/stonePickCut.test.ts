import { describe, it, expect } from 'vitest';
import { applyImpact } from '@/lib/brain/sculpting';
import { getTool } from '@/lib/brain/toolCatalog';
import { playerSwingEnergy } from '@/lib/world/swingEnergy';
import { bondTermForKind } from '@/lib/world/toolActions';
import type { BuilderBlock } from '@/lib/brain/builderBlockEngine';

// Real predicate, no mocks: a player's Stone Pick swing must bite a boulder.
describe('Stone Pick against a granite boulder', () => {
  it('cuts at a calm player swing', () => {
    const pick = getTool('tool_pick_stone')!;
    const block = { id: 'stone-0', bodyId: 'stone:stone-0', kind: 'stone', meta: {} } as unknown as BuilderBlock;
    const res = applyImpact({
      tool: pick,
      swingEnergy: playerSwingEnergy(pick.mass, 1e-5),
      curvatureLoad: 0,
      target: { kind: 'block', block, bondTerm: bondTermForKind('stone') },
    });
    expect(res.cut).toBe(true);
  });
});
