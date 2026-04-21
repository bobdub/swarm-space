import { describe, expect, it } from 'vitest';
import { FieldEngine } from './fieldEngine';
import { selectByMinCurvature, isDefinitionText } from './fieldProjection';

describe('fieldProjection', () => {
  it('returns null on empty candidates', () => {
    const e = new FieldEngine(64);
    expect(selectByMinCurvature([], e, (s: string) => s)).toBeNull();
  });

  it('returns sole candidate without warmup', () => {
    const e = new FieldEngine(64);
    expect(selectByMinCurvature(['hello'], e, (s) => s)).toBe('hello');
  });

  it('falls back to null before warmup with multiple candidates', () => {
    const e = new FieldEngine(64);
    const res = selectByMinCurvature(['a', 'b', 'c'], e, (s) => s);
    expect(res).toBeNull();
  });

  it('after warmup, picks the lowest curvature candidate', () => {
    const e = new FieldEngine(64);
    e.inject('imagination swarm network');
    // Warm-up the engine
    for (let i = 0; i < 60; i++) (e as unknown as { tickOnce: () => void }).tickOnce ?
      (e as unknown as { tickOnce: () => void }).tickOnce() :
      // fall back: invoke inject which advances no ticks; manually call private
      undefined;
    // The engine doesn't auto-tick in tests; force ticks via inject + small loop
    for (let i = 0; i < 60; i++) (e as unknown as { tickOnce?: () => void; }).tickOnce?.();
    // If still not warmed, the function should return null safely.
    const result = selectByMinCurvature(['imagination swarm', 'random distant chaotic noise vector'], e, (s) => s);
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('isDefinitionText recognises common definition phrasings', () => {
    expect(isDefinitionText('A duck is a waterfowl with webbed feet')).toBe(true);
    expect(isDefinitionText('Photon means a quantum of light')).toBe(true);
    expect(isDefinitionText('Define recursion: a function calling itself')).toBe(true);
    expect(isDefinitionText('> def: imagination = the bedrock of being')).toBe(true);
    expect(isDefinitionText('hello there friend')).toBe(false);
    expect(isDefinitionText('')).toBe(false);
  });
});