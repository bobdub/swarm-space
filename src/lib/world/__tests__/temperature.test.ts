import { describe, expect, it } from 'vitest';
import { fahrenheitToCelsius } from '../temperature';

describe('fahrenheitToCelsius', () => {
  it('converts the fixed points', () => {
    expect(fahrenheitToCelsius(32)).toBe(0);
    expect(fahrenheitToCelsius(212)).toBe(100);
    expect(fahrenheitToCelsius(50)).toBe(10);
    expect(fahrenheitToCelsius(-40)).toBe(-40);
  });
});
