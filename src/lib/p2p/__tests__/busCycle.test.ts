import { describe, it, expect, beforeEach } from 'vitest';
import { computeSmoothness, selectWaitingCandidate, isHelperOnDuty, HELPER_ROTATION_MS } from '../globalCell';
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

describe('Bus cycle — waiting candidate selection (Gun.js flow)', () => {
  const base = { smoothness: 0.5, waitAgeMs: 10_000, sameRoom: false };

  it('an isolated node dials the most recently active peer in the Cell', () => {
    const winner = selectWaitingCandidate([
      { ...base, peerId: 'peer-old', remoteConns: 2, helper: true, lastSeenAt: 1_000 },
      { ...base, peerId: 'peer-fresh', remoteConns: 2, helper: true, lastSeenAt: 9_000 },
    ]);
    expect(winner?.peerId).toBe('peer-fresh');
  });

  it('a helper on duty beats a fresher non-helper', () => {
    const winner = selectWaitingCandidate([
      { ...base, peerId: 'peer-idle', remoteConns: 0, helper: false, lastSeenAt: 9_000 },
      { ...base, peerId: 'peer-helper', remoteConns: 3, helper: true, lastSeenAt: 1_000 },
    ]);
    expect(winner?.peerId).toBe('peer-helper');
  });

  it('same-room peers still outrank helpers and recency', () => {
    const winner = selectWaitingCandidate([
      { ...base, peerId: 'peer-helper', remoteConns: 3, helper: true, lastSeenAt: 9_000 },
      { ...base, peerId: 'peer-room', remoteConns: 0, helper: false, lastSeenAt: 1_000, sameRoom: true },
    ]);
    expect(winner?.peerId).toBe('peer-room');
  });

  it('falls back to deterministic peerId ordering on a full tie', () => {
    const winner = selectWaitingCandidate([
      { ...base, peerId: 'peer-b', remoteConns: 1, helper: true, lastSeenAt: 5_000 },
      { ...base, peerId: 'peer-a', remoteConns: 1, helper: true, lastSeenAt: 5_000 },
    ]);
    expect(winner?.peerId).toBe('peer-a');
  });

  it('returns null when no one is waiting', () => {
    expect(selectWaitingCandidate([])).toBeNull();
  });
});

describe('Helper duty rotation', () => {
  const t = 1_800_000_000_000;

  it('isolated peers are never helpers', () => {
    expect(isHelperOnDuty('peer-x', 0, t)).toBe(false);
  });

  it('small meshes (<=2 connections) always welcome newcomers', () => {
    expect(isHelperOnDuty('peer-x', 1, t)).toBe(true);
    expect(isHelperOnDuty('peer-y', 2, t + HELPER_ROTATION_MS)).toBe(true);
  });

  it('larger meshes rotate duty across 10-minute slots', () => {
    // A given peer cycles on/off duty as slots advance (deterministic, not random).
    const duties = [0, 1, 2].map(i => isHelperOnDuty('peer-x', 10, t + i * HELPER_ROTATION_MS));
    expect(new Set(duties).size).toBe(2);
    // Same inputs always agree — no per-node divergence.
    expect(isHelperOnDuty('peer-x', 10, t)).toBe(duties[0]);
  });

  it('in a full mesh at least one of many peers is on duty', () => {
    const peers = Array.from({ length: 20 }, (_, i) => `peer-${i}`);
    const onDuty = peers.filter(p => isHelperOnDuty(p, 20, t));
    expect(onDuty.length).toBeGreaterThan(0);
    expect(onDuty.length).toBeLessThan(20);
  });
});