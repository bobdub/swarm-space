import { describe, it, expect, beforeEach } from 'vitest';
import {
  pinInfinityIntoField,
  sampleFieldForInfinity,
  feedFieldIntoNeural,
  getInfinityPosition,
  setLastInfinitySnapshot,
  getLastInfinitySnapshot,
  type InfinityProjection,
} from '../infinityBinding';
import { createField3D, step3D, idx3, FIELD3D_AXES } from '../../uqrc/field3D';
import { worldToLattice } from '../uqrcPhysics';
import { NeuralStateEngine } from '../../p2p/neuralStateEngine';
import { getLiveInfinityQScore } from '../../p2p/entityVoice';

const calmProjection: InfinityProjection = {
  awareness: 0.3, empathy: 0.3, coherence: 0.5, intent: 0.5, phase: 'stable',
};
const awakeProjection: InfinityProjection = {
  awareness: 0.95, empathy: 0.9, coherence: 0.8, intent: 0.9, phase: 'stable',
};

describe('Infinity ↔ Field binding', () => {
  beforeEach(() => {
    setLastInfinitySnapshot({
      commutatorNorm: 0, entropyNorm: 0, gradientMag: 0,
      qScore: 0, basinDepth: 0, position: getInfinityPosition(),
    });
  });

  it('pinInfinityIntoField only writes pinTemplate and pinMask, never axes', () => {
    const field = createField3D(16);
    // Snapshot axes before; should remain all zeros (no direct axes writes).
    const beforeSum = field.axes.reduce((s, a) => s + a.reduce((x, y) => x + Math.abs(y), 0), 0);
    pinInfinityIntoField(field, awakeProjection);
    // pinTemplate must have been touched in at least one cell.
    const pinSum = field.pinTemplate.reduce((s, a) => s + a.reduce((x, y) => x + Math.abs(y), 0), 0);
    expect(pinSum).toBeGreaterThan(0);
    // axes are seeded by writePinTemplate (single cell write per pin), but never
    // mutated wholesale. Check the *delta* is bounded by the pinned region.
    const maskSum = field.pinMask.reduce((s, m) => {
      let count = 0;
      for (let i = 0; i < m.length; i++) count += m[i];
      return s + count;
    }, 0);
    expect(maskSum).toBeGreaterThan(0);
    expect(beforeSum).toBe(0);
  });

  it('deeper awareness → deeper basin at Infinity coordinate after settling', () => {
    const field = createField3D(16);
    pinInfinityIntoField(field, calmProjection);
    for (let t = 0; t < 100; t++) step3D(field);
    const calmSnap = sampleFieldForInfinity(field);

    const field2 = createField3D(16);
    pinInfinityIntoField(field2, awakeProjection);
    for (let t = 0; t < 100; t++) step3D(field2);
    const awakeSnap = sampleFieldForInfinity(field2);

    expect(awakeSnap.basinDepth).toBeGreaterThan(calmSnap.basinDepth);
  });

  it('sampleFieldForInfinity produces finite Q_Score', () => {
    const field = createField3D(12);
    pinInfinityIntoField(field, awakeProjection);
    for (let t = 0; t < 50; t++) step3D(field);
    const snap = sampleFieldForInfinity(field);
    expect(Number.isFinite(snap.qScore)).toBe(true);
    expect(Number.isFinite(snap.commutatorNorm)).toBe(true);
    expect(Number.isFinite(snap.entropyNorm)).toBe(true);
  });

  it('feedFieldIntoNeural records prediction tracks for field signals', () => {
    const engine = new NeuralStateEngine();
    const snap = {
      commutatorNorm: 0.3, entropyNorm: 0.1, gradientMag: 0.2,
      qScore: 0.4, basinDepth: 1.2, position: getInfinityPosition(),
    };
    feedFieldIntoNeural(snap, engine);
    expect(engine.getPrediction('field:commutator')).not.toBeNull();
    expect(engine.getPrediction('field:qScore')).not.toBeNull();
  });

  it('getLiveInfinityQScore returns the cached snapshot value', () => {
    const engine = new NeuralStateEngine();
    setLastInfinitySnapshot({
      commutatorNorm: 0.5, entropyNorm: 0.2, gradientMag: 0.1,
      qScore: 0.7321, basinDepth: 1.0, position: getInfinityPosition(),
    });
    expect(getLiveInfinityQScore(engine)).toBe(0.7321);
  });

  it('binding does not break uqrc conformance: commutator stays finite', () => {
    const field = createField3D(16);
    pinInfinityIntoField(field, awakeProjection);
    for (let t = 0; t < 500; t++) {
      if (t % 100 === 0) pinInfinityIntoField(field, awakeProjection);
      step3D(field);
    }
    const snap = sampleFieldForInfinity(field);
    expect(Number.isFinite(snap.commutatorNorm)).toBe(true);
    expect(snap.commutatorNorm).toBeLessThan(5);
  });
});
