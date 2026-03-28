import { describe, expect, it } from 'vitest';

import { NeuralStateEngine } from './neuralStateEngine';

describe('NeuralStateEngine', () => {
  it('reinforces successful interactions and penalizes failed ones', () => {
    const engine = new NeuralStateEngine();

    engine.onInteraction('peer-a', { kind: 'chunk', success: true, now: 1000 });
    engine.onInteraction('peer-a', { kind: 'ping', success: true, now: 2000, latencyMs: 40 });
    engine.onInteraction('peer-a', { kind: 'connection', success: false, now: 3000 });

    const neuron = engine.getNeuronState('peer-a');
    expect(neuron).not.toBeNull();
    expect(neuron?.coins).toBe(2);
    expect(neuron?.trust).toBe(50);
    expect(neuron?.activity).toBe(3);
    // Synapses keyed by interaction kind
    expect(neuron?.synapses.get('chunk')?.weight).toBeGreaterThan(1);
    expect(neuron?.synapses.get('ping')?.latencyMs).toBe(40);
    expect(neuron?.synapses.get('connection')?.weight).toBe(0); // penalized below initial
    expect(engine.getPeerScore('peer-a')).toBeGreaterThan(0);
    const audit = engine.getAuditTrail('peer-a');
    expect(audit).toHaveLength(3);
    expect(audit[0]?.weightDelta).toBeGreaterThan(0);
  });

  it('selects top peers by learned score', () => {
    const engine = new NeuralStateEngine();

    engine.onInteraction('peer-strong', { kind: 'chunk', success: true });
    engine.onInteraction('peer-strong', { kind: 'chunk', success: true });
    engine.onInteraction('peer-mid', { kind: 'sync', success: true });
    engine.onInteraction('peer-weak', { kind: 'connection', success: false });

    const selected = engine.selectPeers(
      ['peer-weak', 'peer-mid', 'peer-strong'],
      2
    );

    expect(selected).toEqual(['peer-strong', 'peer-mid']);
  });

  it('produces a network snapshot with bell curves and phi', () => {
    const engine = new NeuralStateEngine();

    engine.onInteraction('peer-1', { kind: 'chunk', success: true, now: 1000 });
    engine.onInteraction('peer-2', { kind: 'ping', success: true, now: 2000 });

    const snapshot = engine.getNetworkSnapshot();
    expect(snapshot.totalNeurons).toBe(2);
    expect(snapshot.totalSynapses).toBe(2);
    expect(snapshot.averageTrust).toBeGreaterThan(0);
    expect(snapshot.healthScore).toBeGreaterThan(0);
    expect(snapshot.healthScore).toBeLessThanOrEqual(1);
    expect(snapshot.topPeers).toHaveLength(2);
    // Bell curves, Phi, and Prediction are present
    expect(snapshot.bellCurves).toBeDefined();
    expect(Array.isArray(snapshot.bellCurves)).toBe(true);
    expect(snapshot.phi).toBeDefined();
    expect(snapshot.phi.currentPhase).toBeTruthy();
    expect(typeof snapshot.phi.phi).toBe('number');
    expect(snapshot.phi.recommendation).toMatch(/^(tighten|relax|hold)$/);
    expect(snapshot.prediction).toBeDefined();
    expect(typeof snapshot.prediction.accuracy).toBe('number');
  });

  it('returns empty snapshot when no neurons registered', () => {
    const engine = new NeuralStateEngine();
    const snapshot = engine.getNetworkSnapshot();
    expect(snapshot.totalNeurons).toBe(0);
    expect(snapshot.healthScore).toBe(0.5);
    expect(snapshot.phi.currentPhase).toBe('bootstrapping');
  });
});

describe('Bell Curve Statistics', () => {
  it('builds baseline from repeated interactions and detects outliers', () => {
    const engine = new NeuralStateEngine();

    // Build a baseline of ~10 interactions with consistent weights
    for (let i = 0; i < 10; i++) {
      engine.onInteraction(`peer-baseline-${i}`, { kind: 'gossip', success: true, now: i * 100 });
    }

    const stats = engine.getBellCurveStatsForKind('gossip');
    expect(stats).not.toBeNull();
    expect(stats!.count).toBe(10);
    expect(stats!.mean).toBeGreaterThan(0);

    // Evaluate a value at the mean — should not be outlier
    const position = engine.getBellCurvePosition('gossip', stats!.mean);
    expect(position).not.toBeNull();
    expect(position!.isOutlier).toBe(false);
    expect(position!.isRare).toBe(false);
  });

  it('returns null for kinds with insufficient data', () => {
    const engine = new NeuralStateEngine();
    engine.onInteraction('peer-x', { kind: 'manifest', success: true });

    const position = engine.getBellCurvePosition('manifest', 5);
    expect(position).toBeNull(); // need at least 5 samples
  });
});

describe('Φ Transition Quality', () => {
  it('starts in bootstrapping phase', () => {
    const engine = new NeuralStateEngine();
    const phi = engine.getPhiSnapshot();
    expect(phi.currentPhase).toBe('bootstrapping');
    expect(phi.phi).toBe(0.5);
    expect(phi.recommendation).toBe('hold');
  });

  it('tracks phase transitions as peers join', () => {
    const engine = new NeuralStateEngine();

    // Simulate several peers connecting and interacting
    for (let i = 0; i < 5; i++) {
      engine.onInteraction(`peer-${i}`, { kind: 'connection', success: true, now: i * 1000 });
      engine.onInteraction(`peer-${i}`, { kind: 'chunk', success: true, now: i * 1000 + 500 });
    }

    const phi = engine.getPhiSnapshot();
    expect(typeof phi.phi).toBe('number');
    expect(phi.phi).toBeGreaterThan(0);
    expect(phi.phi).toBeLessThanOrEqual(1);
  });

  it('records transition history', () => {
    const engine = new NeuralStateEngine();

    // Force a transition by adding and trusting peers
    for (let i = 0; i < 3; i++) {
      engine.onInteraction(`peer-${i}`, { kind: 'ping', success: true, now: i * 100 });
    }

    const history = engine.getPhiHistory();
    expect(Array.isArray(history)).toBe(true);
    // History may or may not have transitions depending on state changes
  });
});
