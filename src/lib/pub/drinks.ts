/**
 * drinks — "buy that man a pint".
 *
 * One SWARM transfer to the bar sink, then a gossiped event that pops a
 * glass prop next to each recipient and drops a line into Brain chat.
 * Deliberately not a game mechanic: no state machine, no per-sip ledger.
 */

import { useSyncExternalStore } from 'react';
import { transferSwarm } from '@/lib/blockchain/token';
import { BAR_SINK_ADDRESS } from './stakes';

/** Fixed house price. Cheap enough to be a gesture, not an economy. */
export const DRINK_PRICE = 1;

export interface DrinkEvent {
  id: string;
  fromPeerId: string;
  fromName: string;
  /** Peers who received a glass. */
  toPeerIds: string[];
  /** True when this was a round for the whole table. */
  round: boolean;
  ts: number;
}

/** How long a glass prop stays on the bar next to its owner. */
export const DRINK_TTL_MS = 120_000;

const drinks: DrinkEvent[] = [];
const listeners = new Set<() => void>();
let version = 0;

let drinkGossip: ((evt: DrinkEvent) => void) | null = null;

export function attachDrinkGossip(fn: (evt: DrinkEvent) => void): void {
  drinkGossip = fn;
}

function emit() {
  version++;
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function prune() {
  const cutoff = Date.now() - DRINK_TTL_MS;
  for (let i = drinks.length - 1; i >= 0; i--) {
    if (drinks[i].ts < cutoff) drinks.splice(i, 1);
  }
}

export function drinkChatLine(evt: DrinkEvent): string {
  const who = evt.fromName || evt.fromPeerId.slice(0, 8);
  if (evt.round) return `🍺 ${who} bought the table a round.`;
  const target = evt.toPeerIds[0]?.slice(0, 8) ?? 'someone';
  return `🍺 ${who} bought ${target} a drink.`;
}

/** Local + remote entry point. Idempotent on event id. */
export function recordDrink(evt: DrinkEvent): boolean {
  if (!evt || typeof evt.id !== 'string' || !Array.isArray(evt.toPeerIds)) return false;
  if (drinks.some((d) => d.id === evt.id)) return false;
  drinks.push(evt);
  prune();
  emit();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pub:chat-line', {
      detail: { id: `drink-${evt.id}`, author: 'The Bar', text: drinkChatLine(evt), ts: evt.ts },
    }));
  }
  return true;
}

export function acceptPeerDrink(payload: unknown): boolean {
  const rec = payload as DrinkEvent | undefined;
  if (!rec || typeof rec.id !== 'string') return false;
  return recordDrink({ ...rec, ts: typeof rec.ts === 'number' ? rec.ts : Date.now() });
}

/**
 * Buy a drink for one peer or for everyone seated at the table.
 * Returns the event, or throws when the balance is short.
 */
export async function buyDrink(params: {
  fromPeerId: string;
  fromName: string;
  toPeerIds: string[];
  round?: boolean;
}): Promise<DrinkEvent> {
  const targets = params.toPeerIds.filter(Boolean);
  if (targets.length === 0) throw new Error('No one to buy for');
  const cost = DRINK_PRICE * targets.length;

  await transferSwarm({
    from: params.fromPeerId,
    to: BAR_SINK_ADDRESS,
    amount: cost,
    meta: { kind: 'pub_drink', count: targets.length },
  });

  const evt: DrinkEvent = {
    id: `${params.fromPeerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fromPeerId: params.fromPeerId,
    fromName: params.fromName,
    toPeerIds: targets,
    round: Boolean(params.round) || targets.length > 1,
    ts: Date.now(),
  };
  recordDrink(evt);
  if (drinkGossip) { try { drinkGossip(evt); } catch { /* ignore */ } }
  return evt;
}

/** Live glasses — one entry per (recipient, event) still inside the TTL. */
export function activeDrinkHolders(): { peerId: string; since: number }[] {
  prune();
  const out = new Map<string, number>();
  for (const d of drinks) {
    for (const p of d.toPeerIds) {
      const prev = out.get(p) ?? 0;
      if (d.ts > prev) out.set(p, d.ts);
    }
  }
  return [...out.entries()].map(([peerId, since]) => ({ peerId, since }));
}

export function useDrinks(): DrinkEvent[] {
  useSyncExternalStore(subscribe, () => version, () => version);
  return drinks;
}

/** Test-only reset. */
export function __resetDrinks(): void {
  drinks.length = 0;
  emit();
}
