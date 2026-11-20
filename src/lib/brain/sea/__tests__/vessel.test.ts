import { describe, it, expect } from 'vitest';
import {
  BOAT_CAPACITY,
  BUOYANT_CAPACITY,
  PARTY_SIZE,
  MIN_FREEBOARD,
  PERSON_KG,
  Vessel,
  WATER_DENSITY,
  canBoard,
  freeboardFor,
  restSinkFor,
} from '../vessel';
import { WATERPLANE_AREA } from '../boatHull';
import { BOAT_DECK_Y } from '../boatSpec';

describe('the boat floats', () => {
  it('settles empty at its design draft and stays there for 10 000 steps', () => {
    const v = new Vessel('test');
    v.heave = { sink: 0.15, rate: -0.2 }; // dropped in a little low
    let worst = 0;
    for (let i = 0; i < 10_000; i++) {
      v.step(1 / 60);
      if (i > 600) worst = Math.max(worst, Math.abs(v.heave.sink));
    }
    expect(worst).toBeLessThan(1e-4);
    expect(v.freeboard()).toBeCloseTo(BOAT_DECK_Y, 4);
  });

  it('sinks by Archimedes under load and settles without overshoot', () => {
    const v = new Vessel('test');
    v.setPeople(4);
    let maxSink = 0;
    for (let i = 0; i < 600; i++) {
      v.step(1 / 60);
      maxSink = Math.max(maxSink, v.heave.sink);
    }
    const expected = (4 * PERSON_KG) / (WATER_DENSITY * WATERPLANE_AREA);
    expect(v.heave.sink).toBeCloseTo(expected, 3);
    expect(maxSink).toBeLessThan(expected * 1.02);
    expect(restSinkFor(4 * PERSON_KG)).toBeCloseTo(expected, 6);
  });

  it('takes a party of 10, well inside what the hull floats', () => {
    expect(BUOYANT_CAPACITY).toBe(48);
    expect(freeboardFor(BUOYANT_CAPACITY)).toBeGreaterThanOrEqual(MIN_FREEBOARD);
    expect(freeboardFor(BUOYANT_CAPACITY + 1)).toBeLessThan(MIN_FREEBOARD);
    expect(BOAT_CAPACITY).toBe(PARTY_SIZE);
    expect(PARTY_SIZE).toBe(10);
    expect(canBoard(9)).toBe(true);
    expect(canBoard(10)).toBe(false);
  });

  it('has a waterplane that matches a 7 m open boat', () => {
    expect(WATERPLANE_AREA).toBeGreaterThan(8);
    expect(WATERPLANE_AREA).toBeLessThan(16);
  });
});
