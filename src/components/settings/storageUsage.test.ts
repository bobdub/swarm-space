import { describe, expect, test } from 'bun:test';
import { isBrowserStorageHigh } from './storageUsage';

describe('Browser Storage warning', () => {
  test('warns at 80% or more, not just below the threshold or with unknown quota', () => {
    expect(isBrowserStorageHigh(800, 1000)).toBe(true);
    expect(isBrowserStorageHigh(950, 1000)).toBe(true);
    expect(isBrowserStorageHigh(799, 1000)).toBe(false);
    expect(isBrowserStorageHigh(0, 0)).toBe(false);
    expect(isBrowserStorageHigh(Number.NaN, 1000)).toBe(false);
  });
});