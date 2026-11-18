/**
 * Mining summary — the single source of truth for every mining figure the
 * UI shows (Node Dashboard mining card, Wallet → Mining tab, Wallet header)
 * AND for the SWARM that AutoMiningService actually credits.
 *
 * Earnings are a pure function of the mesh's cumulative MiningStats, and
 * the credited reward is the difference between the current units and the
 * units already paid (see miningPayouts.ts). Because every rounding step is
 * applied to cumulative totals (never to a per-tick delta), the sum of all
 * credited payouts equals the total the displays show.
 */
import type { MiningStats } from "@/lib/p2p/swarmMesh.standalone";
import { getMiningRewards } from "@/lib/blockchain/miningRewards";

/** Hollow (no content proof) confirmed blocks earn half a work unit. */
export const HOLLOW_BLOCK_WEIGHT = 0.5;
/** Heartbeats + acks are paid in units of this many messages. */
export const SERVICE_MESSAGES_PER_UNIT = 10;

export interface MiningEarnings {
  /** Confirmed blocks that carried content proof. */
  fullConfirmedBlocks: number;
  /** Confirmed blocks that were hollow. */
  hollowConfirmedBlocks: number;
  /** Paid units of mesh work (blocks, relays, peer discoveries). */
  meshWorkUnits: number;
  /** Paid units of network service (heartbeats + acks). */
  serviceUnits: number;
  /** Total before the network pool contribution. */
  gross: number;
  /** Network pool contribution. */
  pool: number;
  /** SWARM credited to the miner. */
  net: number;
}

type StatsLike = Partial<Pick<MiningStats,
  | "confirmedBlocks" | "hollowBlocks" | "confirmedHollowBlocks" | "blocksMinedTotal"
  | "blocksRelayed" | "peersDiscovered" | "heartbeatsSent" | "acksReceived"
>> | null | undefined;

function n(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Hollow blocks that were confirmed. Newer stats track this exactly; older
 * persisted stats only know how many *mined* blocks were hollow, so we take
 * the same share of the confirmed blocks.
 */
export function confirmedHollowBlocks(stats: StatsLike): number {
  const confirmed = n(stats?.confirmedBlocks);
  if (typeof stats?.confirmedHollowBlocks === "number") {
    return Math.min(confirmed, n(stats.confirmedHollowBlocks));
  }
  const mined = n(stats?.blocksMinedTotal);
  const hollow = n(stats?.hollowBlocks);
  if (mined <= 0) return Math.min(confirmed, hollow);
  return Math.min(confirmed, Math.round(confirmed * Math.min(1, hollow / mined)));
}

export function meshWorkUnits(stats: StatsLike): number {
  const hollow = confirmedHollowBlocks(stats);
  const full = n(stats?.confirmedBlocks) - hollow;
  return full + Math.floor(hollow * HOLLOW_BLOCK_WEIGHT) + n(stats?.blocksRelayed) + n(stats?.peersDiscovered);
}

export function serviceUnits(stats: StatsLike): number {
  return Math.floor((n(stats?.heartbeatsSent) + n(stats?.acksReceived)) / SERVICE_MESSAGES_PER_UNIT);
}

/** Lifetime earnings implied by the mesh mining counters. */
export function computeMiningEarnings(stats: StatsLike): MiningEarnings {
  const rewards = getMiningRewards();
  const hollow = confirmedHollowBlocks(stats);
  const work = meshWorkUnits(stats);
  const service = serviceUnits(stats);
  const gross = work * rewards.TRANSACTION_PROCESSED + service * rewards.MB_HOSTED;
  const pool = gross * rewards.NETWORK_POOL_PERCENTAGE;
  return {
    fullConfirmedBlocks: n(stats?.confirmedBlocks) - hollow,
    hollowConfirmedBlocks: hollow,
    meshWorkUnits: work,
    serviceUnits: service,
    gross,
    pool,
    net: gross - pool,
  };
}

/** Net SWARM per confirmed block, for "last block" / "next block" hints. */
export function netRewardPerBlock(hollow: boolean): number {
  const rewards = getMiningRewards();
  const weight = hollow ? HOLLOW_BLOCK_WEIGHT : 1;
  return rewards.TRANSACTION_PROCESSED * weight * (1 - rewards.NETWORK_POOL_PERCENTAGE);
}
