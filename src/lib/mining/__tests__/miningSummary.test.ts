import { beforeEach, describe, expect, it } from "vitest";
import { computeMiningEarnings, confirmedHollowBlocks, meshWorkUnits, serviceUnits } from "../miningSummary";
import { settleMiningPayout, __resetMiningPayoutMark } from "../miningPayouts";
import type { MiningStats } from "@/lib/p2p/swarmMesh.standalone";

function stats(partial: Partial<MiningStats>): MiningStats {
  return {
    blocksMinedTotal: 0, blocksRelayed: 0, peersDiscovered: 0,
    heartbeatsSent: 0, heartbeatsReceived: 0, chunksServed: 0,
    acksReceived: 0, lastBlockMinedAt: null, lastHeartbeatAt: null,
    confirmedBlocks: 0, pendingBlocks: 0, hollowBlocks: 0, confirmedHollowBlocks: 0,
    lastConfirmedAt: null, contentMultiplier: 1, seedingActive: false,
    chunksServedSinceLastBlock: 0, blockHeight: 0, consensusFailures: 0,
    transactionsProcessed: 0, spaceHosted: 0,
    ...partial,
  };
}

describe("miningSummary", () => {
  it("pays full confirmed blocks at 1 unit and hollow confirmed blocks at half", () => {
    const s = stats({ confirmedBlocks: 10, confirmedHollowBlocks: 4, blocksRelayed: 3, peersDiscovered: 2 });
    // 6 full + floor(4 * 0.5) + 3 relays + 2 discoveries
    expect(meshWorkUnits(s)).toBe(13);
  });

  it("does not subtract unconfirmed hollow blocks from confirmed ones", () => {
    // 5 hollow blocks mined but none confirmed: all 3 confirmed blocks were full.
    const s = stats({ blocksMinedTotal: 8, hollowBlocks: 5, confirmedBlocks: 3, confirmedHollowBlocks: 0 });
    expect(confirmedHollowBlocks(s)).toBe(0);
    expect(meshWorkUnits(s)).toBe(3);
  });

  it("estimates confirmed hollow blocks for legacy stats without the counter", () => {
    const legacy = { blocksMinedTotal: 10, hollowBlocks: 5, confirmedBlocks: 8 };
    expect(confirmedHollowBlocks(legacy)).toBe(4);
  });

  it("counts service in whole units of 10 messages", () => {
    expect(serviceUnits(stats({ heartbeatsSent: 17, acksReceived: 12 }))).toBe(2);
  });

  it("net equals gross minus the 5% pool", () => {
    const e = computeMiningEarnings(stats({ confirmedBlocks: 20, heartbeatsSent: 100 }));
    expect(e.gross).toBeCloseTo(20 * 0.1 + 10 * 0.05);
    expect(e.pool).toBeCloseTo(e.gross * 0.05);
    expect(e.net).toBeCloseTo(e.gross * 0.95);
  });
});

describe("settleMiningPayout", () => {
  beforeEach(() => { localStorage.clear(); __resetMiningPayoutMark("u1"); });

  it("starts the paid mark at current counters on first sight", () => {
    expect(settleMiningPayout("u1", stats({ confirmedBlocks: 50 }))).toEqual({ meshWorkUnits: 0, serviceUnits: 0 });
  });

  it("pays every unit exactly once so credited total equals the displayed total", () => {
    const start = stats({});
    settleMiningPayout("u1", start);
    let paidWork = 0;
    let paidService = 0;
    let current = start;
    // Simulate many small counter changes (heartbeats one at a time, hollow blocks confirming).
    for (let i = 1; i <= 57; i++) {
      current = stats({
        ...current,
        heartbeatsSent: current.heartbeatsSent + 1,
        acksReceived: current.acksReceived + (i % 3 === 0 ? 1 : 0),
        confirmedBlocks: current.confirmedBlocks + (i % 5 === 0 ? 1 : 0),
        confirmedHollowBlocks: current.confirmedHollowBlocks + (i % 10 === 0 ? 1 : 0),
        blocksRelayed: current.blocksRelayed + (i % 7 === 0 ? 1 : 0),
      });
      const due = settleMiningPayout("u1", current);
      paidWork += due.meshWorkUnits;
      paidService += due.serviceUnits;
    }
    const total = computeMiningEarnings(current);
    expect(paidWork).toBe(total.meshWorkUnits);
    expect(paidService).toBe(total.serviceUnits);
  });

  it("does not pay twice for the same snapshot", () => {
    settleMiningPayout("u1", stats({}));
    const s = stats({ confirmedBlocks: 3 });
    expect(settleMiningPayout("u1", s).meshWorkUnits).toBe(3);
    expect(settleMiningPayout("u1", s).meshWorkUnits).toBe(0);
  });
});
