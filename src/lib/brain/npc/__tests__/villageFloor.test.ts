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

import { topUpVillage, hasBreedingPair } from '../villageFloor';
import { INITIAL_NPCS } from '../seedCommunity';

describe('villageFloor', () => {
  beforeEach(() => { roster.length = 0; });

  it('seeds the full starter village when empty', () => {
    expect(topUpVillage('a')).toBe(INITIAL_NPCS.length);
    expect(hasBreedingPair(roster as never)).toBe(true);
  });

  it('tops a lone survivor back up without duplicating its name', () => {
    roster.push({ id: 'x', name: 'Aria', sex: 'female' });
    topUpVillage('a');
    expect(roster.length).toBe(INITIAL_NPCS.length);
    expect(roster.filter((n) => n.name === 'Aria').length).toBe(1);
    expect(hasBreedingPair(roster as never)).toBe(true);
  });

  it('adds only the missing sex to a big one-sex village', () => {
    for (let i = 0; i < 10; i++) roster.push({ id: `f${i}`, name: `Kid${i}`, sex: 'female' });
    expect(topUpVillage('a')).toBe(1);
    expect(roster.at(-1)?.sex).toBe('male');
  });

  it('leaves a healthy village alone', () => {
    topUpVillage('a');
    expect(topUpVillage('a')).toBe(0);
  });
});
