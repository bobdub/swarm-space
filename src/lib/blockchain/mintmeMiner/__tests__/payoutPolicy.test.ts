import { describe, expect, it } from "vitest";
import { MINTME_UNIT, MINTME_PAYOUT_THRESHOLD_UNITS, planMintMePayout } from "../payoutPolicy";

describe("MintMe community payout policy", () => {
  it("does not release earnings below 25 MINTME", () => {
    const amount = MINTME_PAYOUT_THRESHOLD_UNITS - 1n;
    const plan = planMintMePayout(amount, ["a", "b"]);
    expect(plan.status).toBe("below-threshold");
    expect(plan.peersTotalUnits).toBe(0n);
    expect(plan.communityUnits).toBe(0n);
    expect(plan.remainingPoolUnits).toBe(amount);
  });
  it("retains 5% at exactly 25 MINTME", () => {
    const plan = planMintMePayout(25n * MINTME_UNIT, ["a", "b"]);
    expect(plan.status).toBe("ready");
    expect(plan.communityUnits).toBe(125n * MINTME_UNIT / 100n);
    expect(plan.peersTotalUnits).toBe(2375n * MINTME_UNIT / 100n);
  });
  it("distributes 95% evenly with no separate mining bonus", () => {
    const plan = planMintMePayout(25n * MINTME_UNIT, ["miner", "peer-b", "peer-c", "peer-d", "peer-e"]);
    expect(plan.perPeerUnits).toBe(475n * MINTME_UNIT / 100n);
    expect(plan.peersTotalUnits).toBe(plan.perPeerUnits * 5n);
  });
  it("applies the same percentages to earnings above the threshold", () => {
    const plan = planMintMePayout(50n * MINTME_UNIT, ["a", "b"]);
    expect(plan.communityUnits).toBe(25n * MINTME_UNIT / 10n);
    expect(plan.perPeerUnits).toBe(2375n * MINTME_UNIT / 100n);
  });
  it("counts each recipient once", () => {
    const plan = planMintMePayout(25n * MINTME_UNIT, ["b", "a", "a", " b ", ""]);
    expect(plan.recipients).toEqual(["a", "b"]);
    expect(plan.perPeerUnits).toBe(11875n * MINTME_UNIT / 1000n);
  });
  it("holds earnings when no peers are eligible", () => {
    const plan = planMintMePayout(25n * MINTME_UNIT, []);
    expect(plan.status).toBe("no-recipients");
    expect(plan.remainingPoolUnits).toBe(25n * MINTME_UNIT);
    expect(plan.communityUnits).toBe(0n);
    expect(plan.peersTotalUnits).toBe(0n);
  });
  it("preserves funds and leaves indivisible dust pending", () => {
    const amount = 25n * MINTME_UNIT;
    const plan = planMintMePayout(amount, ["a", "b", "c"]);
    expect(plan.remainingPoolUnits).toBe(2n);
    expect(plan.communityUnits + plan.peersTotalUnits + plan.remainingPoolUnits).toBe(amount);
  });
  it("rejects negative earnings", () => {
    expect(() => planMintMePayout(-1n, ["a"])).toThrow(RangeError);
  });
});