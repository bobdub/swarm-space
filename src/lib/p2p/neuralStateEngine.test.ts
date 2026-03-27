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

  it('produces a network snapshot for UQRC integration', () => {
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
  });

  it('returns empty snapshot when no neurons registered', () => {
    const engine = new NeuralStateEngine();
    const snapshot = engine.getNetworkSnapshot();
    expect(snapshot.totalNeurons).toBe(0);
    expect(snapshot.healthScore).toBe(0.5);
  });
});
