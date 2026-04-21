import { describe, it, expect } from 'bun:test';
import {
  InstinctHierarchy,
  INSTINCT_ORDER,
  INSTINCT_META,
  type LayerSignals,
} from './instinctHierarchy';

function makeHealthySignals(): LayerSignals {
  const signals = InstinctHierarchy.buildDefaultSignals({
    averagePeerTrust: 70,
    activePeerCount: 5,
    signalingHealthy: true,
    chainSynced: true,
    noveltyScore: 0.7,
    semanticDensity: 0.6,
    ethicsConfidence: 0.8,
    phiValue: 0.7,
    bellCurveCount: 4,
  });
  // Ensure exploration layer gets enough signal to be stable
  signals.exploration.discoveryRate = 2;
  signals.creativity.mutationRate = 0.6;
  return signals;
}

describe('InstinctHierarchy', () => {
  it('activates all 9 layers when signals are healthy', () => {
    const h = new InstinctHierarchy();
    const snap = h.evaluate(makeHealthySignals());
    expect(snap.activeDepth).toBe(9);
    expect(snap.lowestUnstable).toBeNull();
    expect(snap.layers.every(l => l.active)).toBe(true);
    expect(h.isFullyCoherent()).toBe(true);
  });

  it('suppresses upper layers when a foundation layer degrades', () => {
    const h = new InstinctHierarchy();
    const signals = makeHealthySignals();
    // Degrade Layer 3 — P2P Connection Integrity
    signals.connectionIntegrity.activePeerCount = 0;
    signals.connectionIntegrity.connectionSuccessRate = 0;
    signals.connectionIntegrity.signalingHealthy = false;

    const snap = h.evaluate(signals);
    expect(snap.lowestUnstable).toBe('connectionIntegrity');
    // Continuous attenuation: layers 1 & 2 stay active, layer 3 degraded,
    // layers 4-9 are *attenuated* (quieted) but never silenced. Floor 0.15.
    expect(snap.layers[0].active).toBe(true);
    expect(snap.layers[1].active).toBe(true);
    expect(snap.layers[2].status).toBe('degraded');
    expect(snap.layers[3].suppressedBy).toBe('connectionIntegrity');
    for (let i = 3; i < 9; i++) {
      expect(snap.layers[i].health).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('attenuates upper layers but floors at 0.15 when local security fails', () => {
    const h = new InstinctHierarchy();
    const signals = makeHealthySignals();
    signals.localSecurity.dataIntegrityScore = 0;
    signals.localSecurity.memoryIntegrity = 0;
    signals.localSecurity.encryptionActive = false;

    const snap = h.evaluate(signals);
    expect(snap.lowestUnstable).toBe('localSecurity');
    // No layer is fully silenced — all carry at least the attenuation floor.
    for (let i = 1; i < 9; i++) {
      expect(snap.layers[i].health).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('has correct metadata for all 9 layers', () => {
    expect(INSTINCT_ORDER.length).toBe(9);
    for (const layer of INSTINCT_ORDER) {
      const meta = INSTINCT_META[layer];
      expect(meta.name).toBeTruthy();
      expect(meta.imperative).toBeTruthy();
      expect(meta.prevents.length).toBeGreaterThan(0);
    }
  });

  it('computes weighted overall health', () => {
    const h = new InstinctHierarchy();
    const snap = h.evaluate(makeHealthySignals());
    expect(snap.overallHealth).toBeGreaterThan(0.5);
    expect(snap.overallHealth).toBeLessThanOrEqual(1);
  });

  it('isLayerActive returns false before evaluation', () => {
    const h = new InstinctHierarchy();
    expect(h.isLayerActive('coherence')).toBe(false);
  });
});
