import { describe, it, expect } from 'vitest';
import {
  applyDartsIntent,
  createDartsState,
  resolveThrow,
  syncDartsSeats,
  activeDartsSeat,
  DARTS_START_SCORE,
} from '../darts';

const A = 'peer-a';
const B = 'peer-b';

describe('darts 501 reducer', () => {
  it('starts everyone on 501', () => {
    const s = createDartsState([A, B]);
    expect(s.scores[A]).toBe(DARTS_START_SCORE);
    expect(activeDartsSeat(s, [A, B])).toBe(A);
  });

  it('ignores throws from the wrong player', () => {
    const s = createDartsState([A, B]);
    const next = applyDartsIntent(s, [A, B], { type: 'throw', peerId: B, accuracy: 1, roll: 0 });
    expect(next).toBe(s);
  });

  it('subtracts points and hands over after three darts', () => {
    let s = createDartsState([A, B]);
    for (let i = 0; i < 3; i++) {
      s = applyDartsIntent(s, [A, B], { type: 'throw', peerId: A, accuracy: 0.5, roll: 0 });
    }
    expect(s.scores[A]).toBe(DARTS_START_SCORE - 60); // 3 x single 20
    expect(activeDartsSeat(s, [A, B])).toBe(B);
    expect(s.throwsLeft).toBe(3);
  });

  it('busts back to the turn-start score', () => {
    let s = createDartsState([A, B]);
    s = { ...s, scores: { ...s.scores, [A]: 10 }, turnStart: { ...s.turnStart, [A]: 10 } };
    s = applyDartsIntent(s, [A, B], { type: 'throw', peerId: A, accuracy: 1, roll: 0 }); // bull 50
    expect(s.scores[A]).toBe(10);
    expect(s.recent[0].label).toContain('BUST');
    expect(activeDartsSeat(s, [A, B])).toBe(B);
  });

  it('declares a winner on an exact checkout', () => {
    let s = createDartsState([A, B]);
    s = { ...s, scores: { ...s.scores, [A]: 50 }, turnStart: { ...s.turnStart, [A]: 50 } };
    s = applyDartsIntent(s, [A, B], { type: 'throw', peerId: A, accuracy: 1, roll: 0 });
    expect(s.scores[A]).toBe(0);
    expect(s.winnerPeerId).toBe(A);
    expect(activeDartsSeat(s, [A, B])).toBeNull();
  });

  it('keeps scores when seats change', () => {
    let s = createDartsState([A]);
    s = applyDartsIntent(s, [A], { type: 'throw', peerId: A, accuracy: 0.5, roll: 0 });
    const scoreA = s.scores[A];
    const synced = syncDartsSeats(s, [A, B]);
    expect(synced.scores[A]).toBe(scoreA);
    expect(synced.scores[B]).toBe(DARTS_START_SCORE);
  });

  it('maps accuracy to the expected bands', () => {
    expect(resolveThrow(1, 0).label).toBe('BULL');
    expect(resolveThrow(0.88, 0).points).toBe(25);
    expect(resolveThrow(0.8, 0).label).toBe('T20');
    expect(resolveThrow(0.6, 0).label).toBe('D20');
    expect(resolveThrow(0.1, 0).points).toBe(0);
  });
});
