import { describe, expect, it } from "vitest";
import { canWithdraw, GAS_HOLD_MINTME, maxWithdrawable, processWithdraw, type WithdrawDeps, type WithdrawEntry } from "../mintmeWithdrawQueue";

describe("MintMe withdrawal gas hold", () => {
  it("holds exactly 1 MINTME for gas", () => expect(GAS_HOLD_MINTME).toBe(1));
  it("blocks a withdrawal when balance is below amount + 1", () => {
    expect(canWithdraw(10, 9.5)).toBe(false);
    expect(canWithdraw(10, 9)).toBe(true);
  });
  it("Max leaves the 1 MINTME hold", () => {
    expect(maxWithdrawable(10)).toBe(9);
    expect(maxWithdrawable(0.5)).toBe(0);
  });
  it("never re-sends an entry already broadcast before a tab close", async () => {
    let sends = 0;
    const deps: WithdrawDeps = { peers: () => 1, contract: () => null, directBacked: async () => true, sendDirect: async () => { sends++; return "0xnew"; }, sendContract: async () => "" };
    const e: WithdrawEntry = { id: "a", to: "0x" + "1".repeat(40), amount: 1, status: "queued", txHash: "0xold", createdAt: 0 };
    const next = await processWithdraw(e, deps);
    expect(next.status).toBe("sent");
    expect(next.txHash).toBe("0xold");
    expect(sends).toBe(0);
  });
});
