/**
 * gameTableStore — one shared store for every pub game table.
 *
 * Shape copied from `barLightsStore`: a plain external store with a
 * last-writer-wins accept path, plus outbound gossip hooks the mesh
 * bridge attaches to. Adding a game means adding a reducer, never new
 * plumbing.
 *
 * Authority model (see .lovable/plan): the table HOST is simply the
 * earliest-joined seat. Seat claims are LWW table snapshots; game moves
 * are intents routed to the host, which runs the reducer and broadcasts
 * the resulting table. Host churn resolves itself because the seat list
 * reorders on leave.
 */

import { useSyncExternalStore } from 'react';
import {
  applyDartsIntent,
  createDartsState,
  syncDartsSeats,
  type DartsIntent,
  type DartsState,
} from './darts';

export type PubGameId = 'darts' | 'chess' | 'liarsDice' | 'holdem';

export interface PubSeat {
  peerId: string;
  username: string;
  joinedAt: number;
}

export interface PubTable {
  tableId: string;
  game: PubGameId;
  seats: PubSeat[];
  /** Optional agreed SWARM stake per seat. 0 = free play (the default). */
  stake: number;
  /** Monotonic revision — stale/duplicate mesh frames are dropped. */
  seq: number;
  updatedAt: number;
  state: DartsState;
}

export type PubIntent = { tableId: string } & DartsIntent;

const tables = new Map<string, PubTable>();
const listeners = new Set<() => void>();
let version = 0;

let localPeerId = '';

/** The scene tells the store who we are so the mesh bridge can route intents. */
export function setLocalPeerId(id: string): void {
  localPeerId = id || '';
}
export function getLocalPeerId(): string {
  return localPeerId;
}

let tableGossip: ((table: PubTable) => void) | null = null;
let intentGossip: ((intent: PubIntent) => void) | null = null;

export function attachPubTableGossip(fn: (table: PubTable) => void): void {
  tableGossip = fn;
}
export function attachPubIntentGossip(fn: (intent: PubIntent) => void): void {
  intentGossip = fn;
}

function emit() {
  version++;
  listeners.forEach((l) => {
    try { l(); } catch { /* ignore */ }
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function seatIdsOf(table: PubTable): string[] {
  return table.seats.map((s) => s.peerId);
}

function blankTable(tableId: string, game: PubGameId): PubTable {
  return {
    tableId,
    game,
    seats: [],
    stake: 0,
    seq: 0,
    updatedAt: 0,
    state: createDartsState([]),
  };
}

export function getTable(tableId: string, game: PubGameId = 'darts'): PubTable {
  const found = tables.get(tableId);
  if (found) return found;
  const fresh = blankTable(tableId, game);
  tables.set(tableId, fresh);
  return fresh;
}

export function getAllTables(): PubTable[] {
  return [...tables.values()];
}

/** The host is whoever sat down first and is still seated. */
export function tableHost(table: PubTable): string | null {
  return table.seats[0]?.peerId ?? null;
}

export function isTableHost(table: PubTable, peerId: string): boolean {
  return Boolean(peerId) && tableHost(table) === peerId;
}

/** Local mutation → bump seq, stamp time, notify, gossip. */
function mutateLocal(tableId: string, game: PubGameId, fn: (t: PubTable) => PubTable | null): void {
  const current = getTable(tableId, game);
  const next = fn(current);
  if (!next) return;
  const stamped: PubTable = { ...next, seq: current.seq + 1, updatedAt: Date.now() };
  tables.set(tableId, stamped);
  emit();
  if (tableGossip) {
    try { tableGossip(stamped); } catch { /* ignore */ }
  }
}

export function joinTable(params: {
  tableId: string;
  game?: PubGameId;
  peerId: string;
  username: string;
}): void {
  const { tableId, peerId, username } = params;
  if (!tableId || !peerId) return;
  mutateLocal(tableId, params.game ?? 'darts', (t) => {
    if (t.seats.some((s) => s.peerId === peerId)) return null;
    const seats = [...t.seats, { peerId, username, joinedAt: Date.now() }];
    return { ...t, seats, state: syncDartsSeats(t.state, seats.map((s) => s.peerId)) };
  });
}

export function leaveTable(tableId: string, peerId: string): void {
  mutateLocal(tableId, 'darts', (t) => {
    if (!t.seats.some((s) => s.peerId === peerId)) return null;
    const seats = t.seats.filter((s) => s.peerId !== peerId);
    return { ...t, seats, state: syncDartsSeats(t.state, seats.map((s) => s.peerId)) };
  });
}

export function setTableStake(tableId: string, stake: number): void {
  const clean = Number.isFinite(stake) && stake > 0 ? Math.floor(stake) : 0;
  mutateLocal(tableId, 'darts', (t) => (t.stake === clean ? null : { ...t, stake: clean }));
}

/**
 * Submit a game move. Host applies it immediately; everyone else relays
 * it to the host over the intent channel and waits for the new state.
 */
export function submitIntent(tableId: string, selfPeerId: string, intent: DartsIntent): void {
  const table = getTable(tableId);
  if (isTableHost(table, selfPeerId)) {
    applyIntentAsHost(tableId, intent);
    return;
  }
  if (intentGossip) {
    try { intentGossip({ tableId, ...intent }); } catch { /* ignore */ }
  }
}

/** Host-side reducer run. Also used when a peer intent arrives. */
export function applyIntentAsHost(tableId: string, intent: DartsIntent): void {
  mutateLocal(tableId, 'darts', (t) => {
    const next = applyDartsIntent(t.state, seatIdsOf(t), intent);
    if (next === t.state) return null;
    return { ...t, state: next };
  });
}

/** Inbound peer table snapshot. LWW on `seq`, then `updatedAt`. */
export function acceptPeerTable(payload: unknown): boolean {
  const rec = payload as Partial<PubTable> | undefined;
  if (!rec || typeof rec.tableId !== 'string' || !Array.isArray(rec.seats)) return false;
  if (typeof rec.seq !== 'number' || !Number.isFinite(rec.seq)) return false;
  const current = tables.get(rec.tableId);
  if (current) {
    if (rec.seq < current.seq) return false;
    if (rec.seq === current.seq && (rec.updatedAt ?? 0) <= current.updatedAt) return false;
  }
  tables.set(rec.tableId, {
    tableId: rec.tableId,
    game: (rec.game as PubGameId) ?? 'darts',
    seats: rec.seats as PubSeat[],
    stake: typeof rec.stake === 'number' ? rec.stake : 0,
    seq: rec.seq,
    updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now(),
    state: (rec.state as DartsState) ?? createDartsState((rec.seats as PubSeat[]).map((s) => s.peerId)),
  });
  emit();
  return true;
}

/** Inbound peer intent — ignored unless we are this table's host. */
export function acceptPeerIntent(payload: unknown, selfPeerId: string = localPeerId): boolean {
  const rec = payload as (Partial<PubIntent> & { tableId?: string }) | undefined;
  if (!rec || typeof rec.tableId !== 'string' || typeof rec.type !== 'string') return false;
  const table = tables.get(rec.tableId);
  if (!table || !isTableHost(table, selfPeerId)) return false;
  applyIntentAsHost(rec.tableId, rec as DartsIntent);
  return true;
}

/** Snapshot for newcomer backfill — only tables we actually know about. */
export function buildPubTableSnapshot(): PubTable[] {
  return getAllTables().filter((t) => t.seq > 0);
}

export function mergePubTableSnapshot(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const rec of list) if (acceptPeerTable(rec)) n++;
  return n;
}

export function useVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export function usePubTable(tableId: string, game: PubGameId = 'darts'): PubTable {
  useVersion();
  return getTable(tableId, game);
}

/** Test-only reset. */
export function __resetPubTables(): void {
  tables.clear();
  emit();
}
