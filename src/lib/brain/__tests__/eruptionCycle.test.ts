import { describe, expect, it } from 'vitest';
import {
  ERUPTION_CYCLE_S,
  FUMAROLE_STEAM,
  POND_LEVEL_M,
  REST_DEPTH_M,
  DRAIN_S,
  cycleHash,
  eruptionCycleAt,
  eruptionStateAt,
  ventEmissionAt,
  ventGlowAt,
} from '../eruptionCycle';
import { ventSupplyPressure, getMantlePressure, updateLavaMantlePin } from '../lavaMantle';
import { createField3D } from '@/lib/uqrc/field3D';
import { getEarthPose } from '../earth';
import { plumeParcelAt } from '../volcanoEffects';
import {
  lavaFlowPaths,
  lavaFlowStateAt,
  saddleAzimuths,
  MIN_TONGUE_SEPARATION_DEG,
  WEATHER_S,
} from '../lavaFlows';
import { sampleTerrainLift } from '../terrainMesh';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '../volcanoOrgan';

const T0 = ERUPTION_CYCLE_S * 12_345; // some cycle far from the epoch

describe('eruption cycle', () => {
  it('is the same on every peer: pure in shared time, bit-exact hash', () => {
    expect(eruptionStateAt(T0 + 321.5)).toEqual(eruptionStateAt(T0 + 321.5));
    expect(cycleHash(7, 1)).toBe(cycleHash(7, 1));
    expect(cycleHash(7, 1)).not.toBe(cycleHash(8, 1));
    for (let k = 0; k < 200; k++) {
      const h = cycleHash(k, 2);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('spends most of its time quiet, and erupts briefly once per cycle', () => {
    const counts = { quiet: 0, unrest: 0, eruption: 0, waning: 0 };
    let n = 0;
    let onsets = 0;
    let prev = '';
    for (let t = T0; t < T0 + ERUPTION_CYCLE_S * 8; t += 5) {
      const phase = eruptionStateAt(t).phase;
      if (phase === 'eruption' && prev !== 'eruption') onsets++;
      prev = phase;
      counts[phase]++;
      n++;
    }
    expect(counts.quiet / n).toBeGreaterThan(0.5);
    // One eruption per game week, lasting minutes: lava is the exception.
    expect(ERUPTION_CYCLE_S).toBe(86400);
    expect(onsets).toBe(8);
    expect(counts.eruption).toBeGreaterThan(0);
    expect(counts.eruption / n).toBeLessThan(0.01);
    // Every cycle fits: onset + eruption + drain before the next begins.
    for (let k = 0; k < 500; k++) {
      const c = eruptionCycleAt(k);
      expect(c.onsetS + c.durationS + DRAIN_S).toBeLessThan(ERUPTION_CYCLE_S);
    }
  });

  it('rests deep in the conduit and rises with pressure only toward onset', () => {
    const c = eruptionCycleAt(Math.floor(T0 / ERUPTION_CYCLE_S));
    const start = eruptionStateAt(c.startS + 1);
    expect(start.level).toBeLessThan(-REST_DEPTH_M * 0.99);
    // Halfway through recharge the head is still far down.
    expect(eruptionStateAt(c.startS + c.onsetS * 0.5).level).toBeLessThan(-REST_DEPTH_M * 0.8);
    let last = -Infinity;
    for (let f = 0; f <= 1; f += 0.05) {
      const s = eruptionStateAt(c.startS + c.onsetS * f);
      expect(s.level).toBeGreaterThanOrEqual(last);
      last = s.level;
    }
    // Continuous across onset, then ponds above the floor.
    expect(eruptionStateAt(c.startS + c.onsetS - 0.01).level).toBeCloseTo(0, 1);
    expect(eruptionStateAt(c.startS + c.onsetS + 30).level).toBeCloseTo(POND_LEVEL_M, 6);
    // Drains back down afterwards.
    expect(eruptionStateAt(c.startS + c.onsetS + c.durationS + DRAIN_S + 1).level)
      .toBeCloseTo(-REST_DEPTH_M, 6);
  });

  it('reads mantle pressure from the shared clock, swinging with the cycle', () => {
    const c = eruptionCycleAt(Math.floor(T0 / ERUPTION_CYCLE_S));
    const supply = ventSupplyPressure();
    const quiet = getMantlePressure(c.startS + 10);
    const charged = getMantlePressure(c.startS + c.onsetS - 1);
    // Pure: same time, same value, regardless of when a device joined or
    // how often the physics stamped the field.
    const field = createField3D(16);
    for (let i = 0; i < 40; i++) {
      field.ticks += 8;
      updateLavaMantlePin(field, getEarthPose(), c.startS + i);
    }
    expect(getMantlePressure(c.startS + 10)).toBe(quiet);
    expect(quiet).toBeCloseTo(supply * 0.85, 6);
    expect(charged).toBeGreaterThan(supply * 1.1);
    // Venting during the eruption lets it fall back.
    expect(getMantlePressure(c.startS + c.onsetS + c.durationS + 5)).toBeLessThan(charged);
  });
});

describe('vent emissions', () => {
  it('is faint white steam when quiet, dark ash only while erupting', () => {
    const c = eruptionCycleAt(Math.floor(T0 / ERUPTION_CYCLE_S));
    const quiet = ventEmissionAt(c.startS + 60);
    expect(quiet.ash).toBe(0);
    expect(quiet.steam).toBeCloseTo(FUMAROLE_STEAM, 3);
    const erupting = ventEmissionAt(c.startS + c.onsetS + 5);
    expect(erupting.ash).toBeGreaterThan(0.4);
    expect(erupting.ash).toBeGreaterThan(quiet.ash);
    const longAfter = ventEmissionAt(c.startS + c.onsetS + c.durationS + 300);
    expect(longAfter.ash).toBeLessThan(0.01);
    expect(ventGlowAt(c.startS + 60)).toBeLessThan(0.1);
    expect(ventGlowAt(c.startS + c.onsetS + 5)).toBeGreaterThan(0.6);
  });

  it('colours each plume parcel by what left the vent at its birth', () => {
    const steam = plumeParcelAt(T0 + 5, 0, 16, [0, 0, 0], () => ({ ash: 0, steam: 0.2 }));
    const ash = plumeParcelAt(T0 + 5, 0, 16, [0, 0, 0], () => ({ ash: 1, steam: 0.5 }));
    const none = plumeParcelAt(T0 + 5, 0, 16, [0, 0, 0], () => ({ ash: 0, steam: 0 }));
    expect(steam.ash).toBe(0);
    expect(ash.ash).toBeGreaterThan(0.6);
    expect(ash.opacity).toBeGreaterThan(steam.opacity);
    expect(ash.radius).toBeGreaterThan(steam.radius);
    expect(ash.position[1]).toBeGreaterThan(steam.position[1]);
    expect(none.opacity).toBe(0);
  });
});

describe('lava flows', () => {
  const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);

  it('leave from separate low saddles and run downhill on the baked ground', () => {
    const az = saddleAzimuths(organ);
    expect(az.length).toBeGreaterThan(0);
    const sep = (MIN_TONGUE_SEPARATION_DEG * Math.PI) / 180;
    for (let i = 0; i < az.length; i++) {
      for (let j = i + 1; j < az.length; j++) {
        const d = Math.abs(((az[i] - az[j] + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        expect(d).toBeGreaterThanOrEqual(sep - 1e-9);
      }
    }
    for (const path of lavaFlowPaths(organ)) {
      expect(path.length).toBeGreaterThan(60);
      // Lifts are the rendered ground's.
      expect(path.lift[3]).toBe(sampleTerrainLift(path.dirs[3]));
      // Net descent, and no long climbs.
      expect(path.lift[path.lift.length - 1]).toBeLessThan(path.lift[0] - 30);
      for (let j = 4; j < path.lift.length; j++) {
        expect(path.lift[j]).toBeLessThan(path.lift[j - 4] + 0.5);
      }
    }
  });

  it('advance while fed, stop at effusion end, then cool dark and weather', () => {
    const c = eruptionCycleAt(Math.floor(T0 / ERUPTION_CYCLE_S));
    const onset = c.startS + c.onsetS;
    const before = lavaFlowStateAt(organ, onset - 1);
    // Nothing left of the previous cycle's field by the next onset.
    expect(before.presence).toBe(0);
    const early = lavaFlowStateAt(organ, onset + 30);
    const late = lavaFlowStateAt(organ, onset + c.durationS - 1);
    const after = lavaFlowStateAt(organ, onset + c.durationS + 200);
    expect(early.fronts[0]).toBeGreaterThan(0);
    expect(late.fronts[0]).toBeGreaterThan(early.fronts[0]);
    expect(after.fronts[0]).toBeCloseTo(lavaFlowStateAt(organ, onset + c.durationS).fronts[0], 6);
    const paths = lavaFlowPaths(organ);
    late.fronts.forEach((f, i) => expect(f).toBeLessThanOrEqual(paths[i].length));
    expect(early.heat).toBe(1);
    expect(early.feed).toBeGreaterThan(0.5);
    expect(after.feed).toBe(0);
    expect(after.heat).toBeLessThan(0.2);
    expect(after.presence).toBeGreaterThan(0);
    expect(lavaFlowStateAt(organ, onset + c.durationS + WEATHER_S + 1).presence).toBe(0);
  });
});
