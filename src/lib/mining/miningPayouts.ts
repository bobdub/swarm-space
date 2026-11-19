/**
 * Mining payouts — credits SWARM the moment the mesh mining counters move,
 * instead of on a fixed polling tick.
 *
 * The amount paid is always `units(current) − units(alreadyPaid)` from the
 * shared mining summary, and the "already paid" mark is persisted per user,
 * so the lifetime total credited equals the figure the mining displays show
 * and nothing is lost to a reload or a missed tick.
 */
import type { MiningStats } from "@/lib/p2p/swarmMesh.standalone";
import { meshWorkUnits, serviceUnits } from "./miningSummary";

export interface PaidMark {
  meshWorkUnits: number;
  serviceUnits: number;
}

export interface MiningPayout {
  meshWorkUnits: number;
  serviceUnits: number;
}

const KEY_PREFIX = "swarm-mining-paid:";

function readMark(userId: string): PaidMark | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PaidMark>;
    if (typeof parsed.meshWorkUnits !== "number" || typeof parsed.serviceUnits !== "number") return null;
    return { meshWorkUnits: parsed.meshWorkUnits, serviceUnits: parsed.serviceUnits };
  } catch {
    return null;
  }
}

function writeMark(userId: string, mark: PaidMark): void {
  try { localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(mark)); } catch { /* storage unavailable */ }
}

/**
 * Work due for payment since the last settlement, and advance the paid mark.
 * The mark moves synchronously, so overlapping calls never pay twice.
 *
 * The first time a user is seen on this device the mark starts at the
 * current counters (work from before this ledger existed was paid by the
 * old interval loop).
 */
export function settleMiningPayout(userId: string, stats: Pick<MiningStats,
  "confirmedBlocks" | "hollowBlocks" | "confirmedHollowBlocks" | "blocksMinedTotal"
  | "blocksRelayed" | "peersDiscovered" | "heartbeatsSent" | "acksReceived">): MiningPayout {
  const current: PaidMark = { meshWorkUnits: meshWorkUnits(stats), serviceUnits: serviceUnits(stats) };
  const paid = readMark(userId);
  if (!paid) {
    writeMark(userId, current);
    return { meshWorkUnits: 0, serviceUnits: 0 };
  }
  const due: MiningPayout = {
    meshWorkUnits: Math.max(0, current.meshWorkUnits - paid.meshWorkUnits),
    serviceUnits: Math.max(0, current.serviceUnits - paid.serviceUnits),
  };
  // Counters can only shrink if local stats were reset; follow them down so
  // new work is paid again from the reset point.
  writeMark(userId, current);
  return due;
}

/** Test helper. */
export function __resetMiningPayoutMark(userId: string): void {
  try { localStorage.removeItem(KEY_PREFIX + userId); } catch { /* ignore */ }
}
