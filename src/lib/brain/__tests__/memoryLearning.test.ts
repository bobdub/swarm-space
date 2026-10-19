import { describe, it, expect } from 'vitest';
import { selectUnlearned, pieceToEvent, LEARN_BATCH } from '../memoryLearning';
import type { MemoryPiece } from '../infinityMemory';

const piece = (id: string, ts: number, learned = false, kind: MemoryPiece['kind'] = 'post'): MemoryPiece =>
  ({ id, kind, text: 'hello mesh', ts, authorHash: 'abcd1234', learned });

describe('memoryLearning', () => {
  it('only picks unlearned pieces, oldest first', () => {
    const out = selectUnlearned([piece('b', 2), piece('a', 1), piece('c', 3, true)]);
    expect(out.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('caps each batch at 60 pieces', () => {
    const many = Array.from({ length: 100 }, (_, i) => piece(`p${i}`, i));
    expect(LEARN_BATCH).toBe(60);
    expect(selectUnlearned(many)).toHaveLength(60);
  });

  it('weighs posts above comments above chat', () => {
    expect(pieceToEvent(piece('p', 1, false, 'post')).reactions).toBe(3);
    expect(pieceToEvent(piece('c', 1, false, 'comment')).reactions).toBe(2);
    expect(pieceToEvent(piece('h', 1, false, 'chat')).reactions).toBe(1);
  });
});
