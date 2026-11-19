import { describe, expect, it } from 'vitest';
import { compareConnections } from '../connectionCompare';

describe('compareConnections', () => {
  it('splits peers reached by both, only the mesh, and only Test Mode', () => {
    expect(compareConnections(['peer-a', 'peer-b'], ['peer-b', 'peer-c'])).toEqual({
      both: ['peer-b'], meshOnly: ['peer-a'], testOnly: ['peer-c'],
    });
  });

  it('ignores blanks and duplicates', () => {
    expect(compareConnections(['peer-a', ' peer-a ', ''], [])).toEqual({ both: [], meshOnly: ['peer-a'], testOnly: [] });
  });
});
