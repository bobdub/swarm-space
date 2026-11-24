import { describe, expect, it } from 'vitest';
import { formatReleaseVersion, versionGap } from '../releaseVersion';

describe('formatReleaseVersion', () => {
  it('shows the counter in thousandths', () => {
    expect(formatReleaseVersion(1)).toBe('0.001');
    expect(formatReleaseVersion(42)).toBe('0.042');
    expect(formatReleaseVersion(999)).toBe('0.999');
    expect(formatReleaseVersion(1000)).toBe('1.000');
    expect(formatReleaseVersion(1234)).toBe('1.234');
  });

  it('falls back for bad input', () => {
    expect(formatReleaseVersion(-1)).toBe('0.000');
    expect(formatReleaseVersion(1.5)).toBe('0.000');
  });

  it('names both versions in the update notice', () => {
    expect(versionGap({ id: 'x', builtAt: 1, release: 12 }, 10)).toBe('You are on v0.010; v0.012 is live. ');
    expect(versionGap({ id: 'x', builtAt: 1, release: 12 }, 0)).toBe('Swarm Space v0.012 is live. ');
    expect(versionGap({ id: 'x', builtAt: 1 }, 10)).toBe('');
  });
});
