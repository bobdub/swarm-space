/**
 * Shared NeuralStateEngine singleton — used by EntityVoice, manager.ts,
 * and any other module that needs access to the network's neural state.
 * Auto-restores from localStorage on first creation.
 */

import { NeuralStateEngine } from './neuralStateEngine';
import { getSharedFieldEngine, type FieldEngine } from '../uqrc/fieldEngine';

let _engine: NeuralStateEngine | null = null;

export function getSharedNeuralEngine(): NeuralStateEngine {
  if (!_engine) {
    _engine = new NeuralStateEngine();
    _engine.restoreFromStorage();
  }
  return _engine;
}

/**
 * Re-export the shared UQRC field engine so other modules can locate it
 * via the same module path as the neural engine.
 */
export { getSharedFieldEngine };
export type { FieldEngine };
