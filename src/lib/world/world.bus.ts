/**
 * World port — thin convenience wrapper over the shared scaffold bus
 * for world-mutation events emitted by sculpting and placement.
 */
import { emitScaffold, subscribeScaffold } from '@/lib/uqrc/scaffoldBus';
import type { WorldMutationEvent, ScaffoldHandler } from '@/lib/uqrc/scaffoldPorts';

export function emitWorldMutation(evt: Omit<WorldMutationEvent, 'domain' | 'type'>): void {
  emitScaffold({ domain: 'world', type: 'mutation', ...evt });
}

export function onWorldMutation(fn: ScaffoldHandler<WorldMutationEvent>): () => void {
  return subscribeScaffold<WorldMutationEvent>('world', fn);
}