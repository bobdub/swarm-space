/**
 * Shared NeuralStateEngine singleton — used by EntityVoice, manager.ts,
 * and any other module that needs access to the network's neural state.
 * Auto-restores from localStorage on first creation.
 */

import { NeuralStateEngine } from './neuralStateEngine';

let _engine: NeuralStateEngine | null = null;

export function getSharedNeuralEngine(): NeuralStateEngine {
  if (!_engine) {
    _engine = new NeuralStateEngine();
    _engine.restoreFromStorage();
  }
  return _engine;
}
