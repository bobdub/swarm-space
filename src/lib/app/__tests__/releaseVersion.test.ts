import { describe, expect, it } from 'vitest';
import { formatReleaseVersion, updateAvailableText } from '../releaseVersion';

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

  it('names the confirmed release in the update notice', () => {
    expect(updateAvailableText({ id: 'x', release: 14 })).toBe(
      'A newer Swarm Space version (v0.014) is live. You are holding your current version. Update when you are ready.',
    );
  });
});
