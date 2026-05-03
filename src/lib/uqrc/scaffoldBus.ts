/**
 * Scaffold Bus — the conductor.
 *
 * Pub/sub layer that routes scaffolding events into the shared UQRC field
 * (via `getSharedFieldEngine`) and notifies cross-scaffolding listeners.
 *
 * Invariants:
 *  - Synchronous within a tick. Cross-tick effects must go through the
 *    field, not direct calls.
 *  - Never reads/writes raw `u`. Only the public FieldEngine API.
 *  - Honors `featureFlags.scaffoldBus`. When disabled, every emit becomes
 *    a no-op so islands revert to standalone behaviour.
 *  - HMR-safe singleton (mirrors getSharedFieldEngine pattern).
 */

import { getSharedFieldEngine } from './fieldEngine';
import { getFeatureFlags } from '@/config/featureFlags';
import type {
  ScaffoldDomain,
  ScaffoldEvent,
  ScaffoldHandler,
} from './scaffoldPorts';

type DomainHandlers = Map<ScaffoldDomain, Set<ScaffoldHandler>>;

const domainHandlers: DomainHandlers = new Map();
const wildcardHandlers = new Set<ScaffoldHandler>();

function bucket(d: ScaffoldDomain): Set<ScaffoldHandler> {
  let s = domainHandlers.get(d);
  if (!s) {
    s = new Set<ScaffoldHandler>();
    domainHandlers.set(d, s);
  }
  return s;
}

/** Subscribe to a single domain. Returns unsubscribe. */
export function subscribeScaffold<E extends ScaffoldEvent>(
  domain: ScaffoldDomain,
  fn: ScaffoldHandler<E>,
): () => void {
  bucket(domain).add(fn as ScaffoldHandler);
  return () => { bucket(domain).delete(fn as ScaffoldHandler); };
}

/** Subscribe to every event regardless of domain (telemetry use). */
export function subscribeScaffoldAll(fn: ScaffoldHandler): () => void {
  wildcardHandlers.add(fn);
  return () => { wildcardHandlers.delete(fn); };
}

/**
 * Translate a scaffolding event into a small field perturbation. Pure
 * mapping — no decisions are made here, only soft injections so the
 * shared field "feels" what each subsystem is doing.
 */
function injectIntoField(evt: ScaffoldEvent): void {
  let engine;
  try { engine = getSharedFieldEngine(); } catch { return; }
  switch (evt.type) {
    case 'mutation': {
      const amp = Math.min(0.4, 0.05 + evt.laborWeight * 0.02);
      engine.inject(`world:${evt.targetKey}`, { amplitude: amp, axis: 0, reward: evt.effectiveCut });
      break;
    }
    case 'decision': {
      engine.inject(`npc:${evt.npcId}:${evt.verb}`, { amplitude: 0.1, axis: 1 });
      break;
    }
    case 'fill': {
      engine.inject(`coin:${evt.coinId}`, { amplitude: 0.08, axis: 2, reward: Math.min(1, evt.delta) });
      break;
    }
    case 'recipe': {
      engine.inject(`lab:${evt.recipeId}`, { amplitude: evt.ok ? 0.18 : 0.05, axis: 0 });
      break;
    }
    case 'custody': {
      engine.inject(`media:${evt.coinId}`, { amplitude: 0.12, axis: 2 });
      break;
    }
  }
}

/** Emit a scaffold event. No-op when the feature flag is off. */
export function emitScaffold(evt: ScaffoldEvent): void {
  if (!getFeatureFlags().scaffoldBus) return;

  // 1. Translate into the shared field (the "physics" side).
  try { injectIntoField(evt); } catch (err) {
    console.warn('[scaffoldBus] field inject failed', err);
  }

  // 2. Fan out to listeners (the "wiring" side).
  for (const fn of bucket(evt.domain)) {
    try { fn(evt); } catch (err) { console.warn('[scaffoldBus] listener error', err); }
  }
  for (const fn of wildcardHandlers) {
    try { fn(evt); } catch (err) { console.warn('[scaffoldBus] wildcard listener error', err); }
  }
}

/** Test helper — clear all listeners. */
export function __resetScaffoldBusForTests(): void {
  domainHandlers.clear();
  wildcardHandlers.clear();
}