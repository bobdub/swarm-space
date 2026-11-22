import { describe, it, expect } from 'vitest';
import { Axe, Flag, Hammer, Pickaxe, Shovel, Slice } from 'lucide-react';
import { toolIconFor } from '../toolIcon';

describe('toolIconFor', () => {
  it('shows each tool its own icon', () => {
    expect(toolIconFor('tool_knife_stone')).toBe(Slice);
    expect(toolIconFor('tool_axe_stone')).toBe(Axe);
    expect(toolIconFor('tool_shovel_stone')).toBe(Shovel);
    expect(toolIconFor('tool_pick_stone')).toBe(Pickaxe);
    expect(toolIconFor('tool_boundary_marker')).toBe(Flag);
  });

  it('falls back to the hammer for unknown items', () => {
    expect(toolIconFor('not_a_tool')).toBe(Hammer);
  });
});
