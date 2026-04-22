import { describe, it, expect, beforeEach } from 'vitest';
import { FieldEngine } from '../fieldEngine';
import {
  recordTurn,
  getPrevTurn,
  attractToPrev,
  selectBridgingReply,
  selectBridgingToken,
  temperatureFromQ,
  targetLengthFromQ,
  topKFromQ,
  __resetConversationAttractionForTests,
  __getBridgePinCount,
  __getRingSize,
} from '../conversationAttraction';

function warmUp(engine: FieldEngine, n = 60): void {
  for (let i = 0; i < n; i++) {
    (engine as unknown as { tickOnce?: () => void }).tickOnce?.();
  }
}

describe('conversationAttraction', () => {
  beforeEach(() => __resetConversationAttractionForTests());

  it('ring buffer evicts past 16 entries', () => {
    const e = new FieldEngine(64);
    for (let i = 0; i < 20; i++) recordTurn(e, `peer-${i}`, `hello ${i}`, 1_000 + i);
    expect(__getRingSize()).toBe(16);
  });

  it('getPrevTurn excludes same speaker and respects window', () => {
    const e = new FieldEngine(64);
    const t0 = 1_000_000;
    recordTurn(e, 'A', 'hi there', t0);
    recordTurn(e, 'A', 'still A', t0 + 1_000);
    expect(getPrevTurn('A', t0 + 2_000)).toBeNull();

    recordTurn(e, 'B', 'hello A', t0 + 3_000);
    const prev = getPrevTurn('A', t0 + 4_000);
    expect(prev?.speakerId).toBe('B');

    // Outside 90 s window
    expect(getPrevTurn('A', t0 + 200_000)).toBeNull();
  });

  it('attractToPrev returns a midpoint bridge site and registers a pin', () => {
    const e = new FieldEngine(128);
    const prev = recordTurn(e, 'A', 'curvature pattern emerges', 10_000);
    const cur  = recordTurn(e, 'B', 'meaning bridges across', 11_000);
    const before = __getBridgePinCount();
    const { bridgeSite } = attractToPrev(e, cur, prev, 11_000);
    expect(bridgeSite).toBeGreaterThanOrEqual(0);
    expect(bridgeSite).toBeLessThan(128);
    expect(__getBridgePinCount()).toBe(before + 1);
  });

  it('caps simultaneous bridge pins at 8 (LRU eviction)', () => {
    const e = new FieldEngine(128);
    for (let i = 0; i < 12; i++) {
      const a = recordTurn(e, `A${i}`, `prev text ${i}`, 1_000 + i * 100);
      const b = recordTurn(e, `B${i}`, `next text ${i}`, 1_050 + i * 100);
      attractToPrev(e, b, a, 1_050 + i * 100);
    }
    expect(__getBridgePinCount()).toBeLessThanOrEqual(8);
  });

  it('selectBridgingReply returns first candidate when field is cold', () => {
    const e = new FieldEngine(64);
    const pick = selectBridgingReply(['alpha', 'beta', 'gamma'], e);
    // Cold field → selectByMinCurvature returns null, falls back to first non-empty.
    expect(pick).toBe('alpha');
  });

  it('selectBridgingReply picks among warmed candidates', () => {
    const e = new FieldEngine(128);
    warmUp(e, 80);
    const picked = selectBridgingReply(
      ['the curvature settles into a basin', 'random distant chaotic noise vector'],
      e,
    );
    expect(typeof picked).toBe('string');
    expect(picked && picked.length).toBeGreaterThan(0);
  });

  it('selectBridgingToken returns null on cold field', () => {
    const e = new FieldEngine(128);
    const pick = selectBridgingToken(e, 17, ['alpha', 'beta', 'gamma']);
    expect(pick).toBeNull();
  });

  it('selectBridgingToken honors locality gate when warm', () => {
    const e = new FieldEngine(128);
    warmUp(e, 80);
    const L = e.getLatticeLength();
    const gate = Math.max(2, Math.floor(L / 8));

    // Generate a synthetic vocabulary pool of 60 random tokens.
    const pool: string[] = [];
    for (let i = 0; i < 60; i++) {
      pool.push(`tok${Math.random().toString(36).slice(2, 8)}`);
    }

    const trials = 50;
    let inGate = 0;
    for (let t = 0; t < trials; t++) {
      const bridgeSite = Math.floor(Math.random() * L);
      // Pick 6 random candidates per trial.
      const candidates: string[] = [];
      for (let i = 0; i < 6; i++) candidates.push(pool[Math.floor(Math.random() * pool.length)]);
      const pick = selectBridgingToken(e, bridgeSite, candidates);
      if (!pick) continue;
      const sites = e.getSitesForText(pick);
      const arc = sites.length === 0
        ? L
        : Math.min(...sites.map((s) => {
            const d = Math.abs(((s - bridgeSite) % L + L) % L);
            return Math.min(d, L - d);
          }));
      // Pool always contains a site within gate by birthday paradox at 60 tokens
      // — selectBridgingToken must prefer it when one exists.
      const anyLocal = candidates.some((c) => {
        const cs = e.getSitesForText(c);
        const a = cs.length === 0 ? L : Math.min(...cs.map((s) => {
          const d = Math.abs(((s - bridgeSite) % L + L) % L);
          return Math.min(d, L - d);
        }));
        return a <= gate;
      });
      if (!anyLocal || arc <= gate) inGate++;
    }
    expect(inGate / trials).toBeGreaterThanOrEqual(0.8);
  });

  it('temperatureFromQ and targetLengthFromQ are monotonic in q', () => {
    expect(temperatureFromQ(0)).toBeLessThan(temperatureFromQ(0.5));
    expect(temperatureFromQ(0.5)).toBeLessThan(temperatureFromQ(1));
    // Length is inversely monotonic: calmer field → longer reply
    expect(targetLengthFromQ(0)).toBeGreaterThanOrEqual(targetLengthFromQ(0.5));
    expect(targetLengthFromQ(0.5)).toBeGreaterThanOrEqual(targetLengthFromQ(1));
    // top-K is also inversely monotonic: turbulent → wider exploration? Plan
    // says k = clamp(round(8 - 4q), 3, 12), so k decreases with q.
    expect(topKFromQ(0)).toBeGreaterThanOrEqual(topKFromQ(1));
  });
});
