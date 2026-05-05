/**
 * NPC port — bridges NpcDecisionEvents through the shared scaffold bus.
 *
 * The engine NEVER reaches into scaffoldBus directly; it always goes
 * through `emitNpcDecision` / `onNpcDecision`. This keeps the dependency
 * one-way and lets tests stub the port without booting the field.
 *
 * Phase 2: NPCs come alive — the live tick fans every selected verb out
 * via this port so:
 *   • scaffoldHealth tracks the npc sub-Q,
 *   • coin.bus / world.bus / lab.bus can react to NPC behaviour,
 *   • the field "feels" each decision (axis-1 nudge) for downstream
 *     min-curvature calls.
 */
import { emitScaffold, subscribeScaffold } from '@/lib/uqrc/scaffoldBus';
import type {
  NpcDecisionEvent,
  ScaffoldHandler,
} from '@/lib/uqrc/scaffoldPorts';

export function emitNpcDecision(
  evt: Omit<NpcDecisionEvent, 'domain' | 'type'>,
): void {
  emitScaffold({ domain: 'npc', type: 'decision', ...evt });
}

export function onNpcDecision(
  fn: ScaffoldHandler<NpcDecisionEvent>,
): () => void {
  return subscribeScaffold<NpcDecisionEvent>('npc', fn);
}