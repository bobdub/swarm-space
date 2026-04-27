import { describe, it, expect, beforeEach } from 'vitest';
import { computeSmoothness } from '../globalCell';
import { recordHandshake, _resetSynapseForTests, getSmoothness } from '../synapseLayer';

describe('Bus cycle — synapse smoothness layer', () => {
  beforeEach(() => {
    _resetSynapseForTests();
  });

  it('returns 0 smoothness for unknown peers (neutral newcomers)', () => {
    expect(getSmoothness('peer-unknown')).toBe(0);
  });

  it('rewards a peer with a successful handshake history', () => {
    recordHandshake('peer-a', true);
    recordHandshake('peer-a', true);
    recordHandshake('peer-a', true);
    expect(getSmoothness('peer-a')).toBeGreaterThan(0.9);
  });

  it('penalizes a peer with failed handshakes', () => {
    recordHandshake('peer-b', true);
    recordHandshake('peer-b', false);
    recordHandshake('peer-b', false);
    recordHandshake('peer-b', false);
    expect(getSmoothness('peer-b')).toBeLessThan(0.3);
  });

  it('decays smoothness with time (recency)', () => {
    recordHandshake('peer-c', true);
    const fresh = getSmoothness('peer-c', Date.now());
    const future = getSmoothness('peer-c', Date.now() + 30 * 60_000); // 30 min later
    expect(future).toBeLessThan(fresh);
    expect(future).toBeLessThan(0.05);
  });
});

describe('Bus cycle — composite smoothness', () => {
  beforeEach(() => {
    _resetSynapseForTests();
  });

  it('blends trust, synapse, latency, and load into [0,1]', () => {
    const score = computeSmoothness(0.8, 'peer-x', 5, 20);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('a historically reliable peer beats an equal-trust newcomer', () => {
    recordHandshake('peer-vet', true);
    recordHandshake('peer-vet', true);
    const veteran = computeSmoothness(0.5, 'peer-vet', 5, 20);
    const newcomer = computeSmoothness(0.5, 'peer-new', 5, 20);
    expect(veteran).toBeGreaterThan(newcomer);
  });

  it('higher local load reduces smoothness', () => {
    const empty = computeSmoothness(0.6, 'peer-y', 0, 20);
    const full  = computeSmoothness(0.6, 'peer-y', 20, 20);
    expect(empty).toBeGreaterThan(full);
  });

  it('clamps non-finite trust to 0', () => {
    const score = computeSmoothness(NaN, 'peer-z', 5, 20);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});