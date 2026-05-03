/**
 * Per-scaffolding sub-Q tracker.
 *
 * Listens to the scaffold bus and maintains a small EMA of activity per
 * domain so the App Health badge can show six sub-scores instead of one
 * monolithic Q. Pure observer — never injects back into the field.
 */

import { subscribeScaffoldAll } from './scaffoldBus';
import type { ScaffoldDomain, ScaffoldEvent } from './scaffoldPorts';

const ALPHA = 0.2;
const DOMAINS: ScaffoldDomain[] = ['world', 'npc', 'coin', 'lab', 'media', 'health'];

const subQ: Record<ScaffoldDomain, number> = {
  world: 0, npc: 0, coin: 0, lab: 0, media: 0, health: 0,
};

const listeners = new Set<(snap: Readonly<Record<ScaffoldDomain, number>>) => void>();
let booted = false;

function magnitude(evt: ScaffoldEvent): number {
  switch (evt.type) {
    case 'mutation': return Math.min(2, evt.effectiveCut);
    case 'decision': return Math.abs(evt.qDelta);
    case 'fill':     return Math.min(1, evt.delta);
    case 'recipe':   return evt.ok ? 0.7 : 0.2;
    case 'custody':  return 0.5;
    default:         return 0;
  }
}

function ensureBoot(): void {
  if (booted) return;
  booted = true;
  subscribeScaffoldAll((evt) => {
    const m = magnitude(evt);
    const d = evt.domain;
    subQ[d] = (1 - ALPHA) * subQ[d] + ALPHA * m;
    for (const fn of listeners) {
      try { fn(subQ); } catch { /* ignore */ }
    }
  });
}

export function getScaffoldSubQ(): Readonly<Record<ScaffoldDomain, number>> {
  ensureBoot();
  return subQ;
}

export function subscribeScaffoldSubQ(
  fn: (snap: Readonly<Record<ScaffoldDomain, number>>) => void,
): () => void {
  ensureBoot();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const SCAFFOLD_DOMAINS = DOMAINS;