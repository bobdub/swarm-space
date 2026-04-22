import { describe, it, expect, beforeEach } from 'vitest';
import { FieldEngine } from '../fieldEngine';
import {
  recordTurn,
  getPrevTurn,
  attractToPrev,
  selectBridgingReply,
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
});
