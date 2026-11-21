import { describe, expect, it } from 'vitest';
import { FLOCK_CHICK_CAP, NEST_EGG_CAP, broodChicks, getHens, nestEggs } from '../land/chickens';
import { HOME_SPACING_ROAMS, SCHOOL_ROAM_M, SHARK_ROAM_M, arcMetres, getSeaLife } from '../sea/seaLife';

describe('life capacity', () => {
  it('a nest never holds more than its cap of eggs or chicks over a long day', () => {
    const hens = getHens();
    const flocks = new Map<string, typeof hens>();
    for (const h of hens) flocks.set(h.flock, [...(flocks.get(h.flock) ?? []), h]);
    const flock = [...flocks.values()][0] ?? [];
    for (let m = 0; m < 24 * 60; m += 7) {
      const at = 1_800_000_000_000 + m * 60_000;
      expect(nestEggs(flock, at).length).toBeLessThanOrEqual(NEST_EGG_CAP);
      expect(broodChicks(flock, at).length).toBeLessThanOrEqual(FLOCK_CHICK_CAP);
    }
  });
  it('lattice schools and sharks keep their spacing', () => {
    const life = getSeaLife().filter((c) => !c.id.includes('-v'));
    for (const kind of ['school', 'shark'] as const) {
      const min = HOME_SPACING_ROAMS * (kind === 'school' ? SCHOOL_ROAM_M : SHARK_ROAM_M);
      const of = life.filter((c) => c.kind === kind);
      for (let i = 0; i < of.length; i++) for (let j = i + 1; j < of.length; j++) {
        expect(arcMetres(of[i].home, of[j].home)).toBeGreaterThanOrEqual(min);
      }
    }
  });
});
