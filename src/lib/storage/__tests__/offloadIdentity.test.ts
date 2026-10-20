import { describe, it, expect } from 'vitest';
import { CLEARABLE_STORES } from '../offload';

describe('storage cleanup never removes identity keys', () => {
  it('excludes account/identity stores from clearable stores', () => {
    for (const store of ['users', 'meta']) {
      expect(CLEARABLE_STORES).not.toContain(store);
    }
  });
});
