import { afterEach, describe, expect, it } from 'vitest';
import { CONSTELLATIONS, constellationCentre } from '../constellations';
import { GAME_DAY_SECONDS, getEarthPoseAt } from '../earth';
import { skyCadenceAt } from '../skyCadence';
import {
  FIND_HOLD_S,
  FIND_QUIET_S,
  altAz,
  compassWord,
  gazeOffsetDeg,
  gazeProgress,
  localSky,
  nightIndexAt,
  sightingHint,
  stepGaze,
  tonightsConstellation,
  villageNoonOffset,
  villagePlace,
} from '../starHunt';
import { foundTonight, getStarHunt, logFind, markChartRead, resetStarHuntForTests } from '../starHuntStore';

describe('star hunt: tonight’s constellation', () => {
  it('counts nights noon to noon, so the chart never changes in the dark', () => {
    const noon = villageNoonOffset();
    const n = 40;
    const start = noon + n * GAME_DAY_SECONDS;
    expect(nightIndexAt(start + 1)).toBe(n);
    expect(nightIndexAt(start + GAME_DAY_SECONDS - 1)).toBe(n);
    // Midnight sits inside the window, never on its edge.
    const place = villagePlace();
    const mid = getEarthPoseAt(start + GAME_DAY_SECONDS / 2);
    expect(skyCadenceAt(localSky(place, mid).pos, mid).starOpacity).toBeGreaterThan(0.5);
  });

  it('picks a figure that is well up after dark, the same for everyone', () => {
    for (let n = 0; n < 400; n += 13) {
      const s = tonightsConstellation(n);
      expect(s.upSamples).toBeGreaterThanOrEqual(4);
      expect(s.bestAlt).toBeGreaterThan(20);
      expect(tonightsConstellation(n).chart.id).toBe(s.chart.id);
    }
  });

  it('varies over the nights: every figure gets its turn', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 365; n++) seen.add(tonightsConstellation(n).chart.id);
    expect(seen.size).toBe(CONSTELLATIONS.length);
  });

  it('gives a loose hint: a compass point and a time of night, never coordinates', () => {
    const hint = sightingHint(tonightsConstellation(7));
    expect(hint).toMatch(/north|south|east|west|overhead/);
    expect(hint).toMatch(/early in the night|around midnight|before dawn/);
    expect(hint).not.toMatch(/\d/);
  });

  it('compass and altitude agree with the local horizon', () => {
    expect(compassWord(0)).toBe('north');
    expect(compassWord(90)).toBe('east');
    expect(compassWord(181)).toBe('south');
    expect(compassWord(-90)).toBe('west');
    const pose = getEarthPoseAt(1234);
    const sky = localSky(villagePlace(), pose);
    expect(altAz(sky.up, sky).alt).toBeCloseTo(90, 5);
    expect(altAz(sky.north, sky).az).toBeCloseTo(0, 5);
    expect(altAz(sky.east, sky).az).toBeCloseTo(90, 5);
  });
});

describe('star hunt: finding by gaze', () => {
  afterEach(() => resetStarHuntForTests());

  it('needs a steady hold, and looking away starts over', () => {
    let g = { held: 0, found: false };
    g = stepGaze(g, true, FIND_HOLD_S / 2);
    expect(g.found).toBe(false);
    g = stepGaze(g, false, 0.2);
    expect(g.held).toBe(0);
    g = stepGaze(g, true, FIND_HOLD_S / 2);
    g = stepGaze(g, true, FIND_HOLD_S / 2);
    expect(g.found).toBe(true);
  });

  it('shows no ring until you are already holding on the figure', () => {
    expect(gazeProgress(FIND_QUIET_S * 0.9)).toBe(0);
    expect(gazeProgress(FIND_HOLD_S)).toBe(1);
  });

  it('measures the gaze against the figure’s centre of light', () => {
    const c = constellationCentre(CONSTELLATIONS[0]);
    expect(gazeOffsetDeg(c, c)).toBeCloseTo(0, 5);
    expect(gazeOffsetDeg([-c[0], -c[1], -c[2]], c)).toBeCloseTo(180, 5);
  });

  it('logs each figure once a night and keeps a tally', () => {
    markChartRead(5);
    expect(getStarHunt().chartNight).toBe(5);
    expect(logFind('cat', 5)?.count).toBe(1);
    expect(logFind('cat', 5)).toBeNull();
    expect(foundTonight('cat', 5)).toBe(true);
    expect(logFind('cat', 9)).toEqual({ firstNight: 5, lastNight: 9, count: 2 });
  });
});
