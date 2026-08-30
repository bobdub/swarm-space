/**
 * seatLock — authoritative seat → world transform resolution.
 *
 * The table host owns the seat list (LWW snapshots through the pub table
 * gossip channel). Every peer therefore knows, deterministically, WHICH
 * stool a given peer occupies: seat index = position in the seat list
 * ordered by join time. Because the stools are ordinary BuilderBlocks
 * with the same ids on every peer, each viewer can resolve the exact
 * seated transform locally instead of waiting for pose broadcasts.
 *
 * This is what stops a seated peer from ever being rendered in an
 * intermediate standing pose: the lock wins over the broadcast body.
 */

import { getAllTables, type PubTable } from './gameTableStore';
import { pubSeatWorldPos } from '@/lib/world/pubAnchors';

export interface SeatLock {
  tableId: string;
  peerId: string;
  index: number;
}

/** Deterministic seat index for `peerId`, or -1 when not seated. */
export function seatIndexOf(table: PubTable, peerId: string): number {
  const ordered = [...table.seats].sort(
    (a, b) => (a.joinedAt - b.joinedAt) || a.peerId.localeCompare(b.peerId),
  );
  return ordered.findIndex((s) => s.peerId === peerId);
}

/** Every seat lock currently known across all synced tables. */
export function listSeatLocks(): SeatLock[] {
  const out: SeatLock[] = [];
  for (const table of getAllTables()) {
    const ordered = [...table.seats].sort(
      (a, b) => (a.joinedAt - b.joinedAt) || a.peerId.localeCompare(b.peerId),
    );
    ordered.forEach((seat, index) => {
      out.push({ tableId: table.tableId, peerId: seat.peerId, index });
    });
  }
  return out;
}

/** The seat lock held by `peerId`, if any. */
export function seatLockFor(peerId: string): SeatLock | null {
  if (!peerId) return null;
  for (const table of getAllTables()) {
    const index = seatIndexOf(table, peerId);
    if (index >= 0) return { tableId: table.tableId, peerId, index };
  }
  return null;
}

/**
 * Exact world position of the body centre for a seated peer, or null when
 * the peer is not seated / the stool is not registered in this scene.
 */
export function seatedTransform(peerId: string): [number, number, number] | null {
  const lock = seatLockFor(peerId);
  if (!lock) return null;
  return pubSeatWorldPos(lock.tableId, lock.index);
}
