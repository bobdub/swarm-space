import { describe, expect, it } from "vitest";
import { startMining, resumeMining } from "../mining";
import { mintSwarm } from "../token";

describe("SWARM is only mined on the mesh", () => {
  it("refuses the wallet-side mining loop, whose blocks never reached peers", async () => {
    await expect(startMining("member")).rejects.toThrow(/only mined on the SWARM Mesh/);
    await expect(resumeMining("member")).rejects.toThrow(/only mined on the SWARM Mesh/);
  });

  it("refuses device-only SWARM mints, which peers can't verify", async () => {
    await expect(mintSwarm({ to: "member", amount: 5, reason: "test" })).rejects.toThrow(/only issued by block rewards/);
  });
});
