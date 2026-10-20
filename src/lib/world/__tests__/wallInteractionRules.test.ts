import { describe, expect, it } from 'vitest';
import { canViewerInteract, goldLustre, graffitiHoldMs, pickReinforcePayment } from '../wallInteractionRules';

describe('wall viewer interactions', () => {
  it('owners cannot reinforce or graffiti their own wall', () => {
    expect(canViewerInteract({ actorId: 'a' }, 'a')).toBe(false);
    expect(canViewerInteract({ actorId: 'a' }, 'b')).toBe(true);
    expect(canViewerInteract({ actorId: 'a' }, null)).toBe(false);
  });
  it('reinforce costs 1 SWARM, falling back to 10 credits', () => {
    expect(pickReinforcePayment(5, 100)).toEqual({ asset: 'swarm', amount: 1 });
    expect(pickReinforcePayment(0.5, 10)).toEqual({ asset: 'credits', amount: 10 });
    expect(pickReinforcePayment(0, 9)).toBeNull();
  });
  it('each graffiti on the same wall takes longer, capped at 3 minutes', () => {
    expect(graffitiHoldMs(0)).toBe(1500);
    expect(graffitiHoldMs(1)).toBe(3000);
    expect(graffitiHoldMs(2)).toBeGreaterThan(graffitiHoldMs(1));
    expect(graffitiHoldMs(50)).toBe(180_000);
  });
  it('gold lustre grows with reinforcements', () => {
    expect(goldLustre(0).emissiveIntensity).toBe(0);
    expect(goldLustre(10).metalness).toBeGreaterThan(goldLustre(1).metalness);
  });
});
