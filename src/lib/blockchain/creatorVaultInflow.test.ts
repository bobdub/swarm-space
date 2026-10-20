import { describe, expect, it } from "vitest";
import { evaluateVaultInflow, type VaultInflowState } from "./creatorVaultInflow";

const C = "0x" + "a".repeat(40);
const base = (o: Partial<VaultInflowState> = {}): VaultInflowState => ({
  heldCustom: {}, stagedCredits: 0, knownContracts: new Set([C]), ...o,
});

describe("creator vault inflow gate", () => {
  it("refunds custom tokens not known on the native ledger", () => {
    expect(evaluateVaultInflow(base({ knownContracts: new Set() }), { kind: "custom", contract: C }, 10).action).toBe("refund");
  });
  it("refunds when the vault already holds 5,000,000 of the token", () => {
    expect(evaluateVaultInflow(base({ heldCustom: { [C]: 5_000_000 } }), { kind: "custom", contract: C }, 1).action).toBe("refund");
  });
  it("refunds when the inflow would push the vault past 5,000,000", () => {
    expect(evaluateVaultInflow(base({ heldCustom: { [C]: 4_999_990 } }), { kind: "custom", contract: C }, 11).action).toBe("refund");
  });
  it("accepts custom tokens up to exactly 5,000,000", () => {
    const d = evaluateVaultInflow(base({ heldCustom: { [C]: 4_999_990 } }), { kind: "custom", contract: C }, 10);
    expect(d.action === "accept" && d.next.heldCustom[C]).toBe(5_000_000);
  });
  it("holds fewer than 100 credits without liquid value", () => {
    const d = evaluateVaultInflow(base(), { kind: "credits" }, 45);
    expect(d.action).toBe("hold");
    expect(d.action !== "refund" && [d.liquidSwarm, d.next.stagedCredits]).toEqual([0, 45]);
  });
  it("wraps every 100 credits into 1 SWARM and keeps the remainder", () => {
    const d = evaluateVaultInflow(base({ stagedCredits: 45 }), { kind: "credits" }, 160);
    expect(d.action !== "refund" && [d.liquidSwarm, d.next.stagedCredits]).toEqual([2, 5]);
  });
  it("refunds non-finite amounts", () => {
    expect(evaluateVaultInflow(base(), { kind: "swarm" }, NaN).action).toBe("refund");
  });
});
