import { describe, it, expect, beforeEach, vi } from 'vitest';

type Fake = { id: string; name: string; sex: 'female' | 'male' };
const roster: Fake[] = [];

vi.mock('../npcRegistry', () => ({ listNpcs: () => [...roster] }));
vi.mock('../npcEngine', () => ({
  spawnNpc: (args: { name: string; sex: 'female' | 'male' }) => {
    const npc = { id: `npc-${roster.length}`, name: args.name, sex: args.sex };
    roster.push(npc);
    return { ok: true, npc };
  },
}));

import { topUpVillage, hasBreedingPair, VILLAGE_FLOOR } from '../villageFloor';

describe('villageFloor', () => {
  beforeEach(() => { roster.length = 0; });

  it('tops a lone survivor back up to the floor without duplicating its name', () => {
    roster.push({ id: 'x', name: 'Aria', sex: 'female' });
    topUpVillage('a');
    expect(roster.length).toBe(VILLAGE_FLOOR);
    expect(roster.filter((n) => n.name === 'Aria').length).toBe(1);
    expect(hasBreedingPair(roster as never)).toBe(true);
  });

  it('adds only the missing sex to a one-sex village at or above the floor', () => {
    for (let i = 0; i < 10; i++) roster.push({ id: `f${i}`, name: `Kid${i}`, sex: 'female' });
    expect(topUpVillage('a')).toBe(1);
    expect(roster.at(-1)?.sex).toBe('male');
  });

  it('leaves a village of four with a pair alone', () => {
    roster.push(
      { id: 'a', name: 'Aria', sex: 'female' },
      { id: 'b', name: 'Beth', sex: 'female' },
      { id: 'c', name: 'Cleo', sex: 'female' },
      { id: 'd', name: 'Ash', sex: 'male' },
    );
    expect(topUpVillage('a')).toBe(0);
  });

  it('refills a village of three even with a pair', () => {
    roster.push(
      { id: 'a', name: 'Aria', sex: 'female' },
      { id: 'b', name: 'Beth', sex: 'female' },
      { id: 'd', name: 'Ash', sex: 'male' },
    );
    expect(topUpVillage('a')).toBe(1);
    expect(roster.length).toBe(VILLAGE_FLOOR);
  });
});
