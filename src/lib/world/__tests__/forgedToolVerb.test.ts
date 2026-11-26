import { describe, expect, it } from 'vitest';
import { registerCustomTool } from '@/lib/brain/toolCatalog';
import { deriveForgedTool } from '@/lib/brain/toolForge';
import { compositionToMolecule } from '@/lib/remix/labMaterials';
import { toolVerbFor } from '@/lib/world/toolActions';

describe('Lab-forged tool swings', () => {
  it('runs the interaction stamped into the tool', () => {
    const mol = compositionToMolecule({ stone: 2, wood: 2 }, 'Test', 7)!;
    const expected = { chop: 'chop', mine: 'mine', dig: 'dig', gather: 'gather' } as const;
    for (const action of Object.keys(expected) as (keyof typeof expected)[]) {
      const tool = deriveForgedTool(mol, { actionKind: action });
      registerCustomTool(tool);
      expect(toolVerbFor(tool.id)).toBe(expected[action]);
    }
  });

  it('keeps the stone tools on their own verbs', () => {
    expect(toolVerbFor('tool_axe_stone')).toBe('chop');
    expect(toolVerbFor('tool_pick_stone')).toBe('mine');
    expect(toolVerbFor('unknown_thing')).toBe('none');
  });
});
