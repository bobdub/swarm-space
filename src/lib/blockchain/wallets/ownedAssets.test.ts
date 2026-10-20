import { describe, expect, it } from "vitest";
import { positiveBalanceAssets } from "./ownedAssets";

describe("wallet asset selection", () => {
  it("excludes zero balances and retains owned tokens without an external price", () => {
    expect(positiveBalanceAssets([
      { id: "SWARM", label: "SWARM", amount: 0 },
      { id: "custom:a", label: "Custom", amount: 12 },
      { id: "coin:a", label: "Coin", amount: 1 },
      { id: "invalid", label: "Unknown", amount: NaN },
    ]).map((asset) => asset.id)).toEqual(["custom:a", "coin:a"]);
  });
});