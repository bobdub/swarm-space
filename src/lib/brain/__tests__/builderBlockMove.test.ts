import { describe, it, expect } from 'vitest';
import { getBuilderBlockEngine } from '../builderBlockEngine';

describe('builderBlockEngine pure moves', () => {
  it('keeps the support basin on a sub-cell step and re-pins on a basin change', () => {
    const engine = getBuilderBlockEngine();
    const block = engine.placeBlock({
      id: 'move-test',
      kind: 'npc:torso',
      anchorPeerId: 'move-test-anchor',
      rightOffset: 1,
      forwardOffset: 1,
    });
    const supportId = block.support.id;

    engine.upgradeBlock('move-test', { rightOffset: 1.01, forwardOffset: 1.01 });
    expect(engine.getBlock('move-test')?.support.id).toBe(supportId);

    engine.upgradeBlock('move-test', { basin: 0.5 });
    expect(engine.getBlock('move-test')?.support.id).not.toBe(supportId);

    engine.removeBlock('move-test', 'npc:torso');
    expect(engine.getBlock('move-test')).toBeUndefined();
  });
});
