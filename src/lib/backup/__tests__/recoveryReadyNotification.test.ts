import { describe, it, expect, vi } from "vitest";

const created: unknown[] = [];
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async (n: unknown) => { created.push(n); return n; }) }));
vi.mock("@/lib/p2p/swarmMesh.standalone", () => ({ getSwarmMeshStandalone: vi.fn() }));

import { notifyRecoveryReady } from "../vaultCustodyMesh";

describe("recovery_ready notification", () => {
  it("fires once per shell version with the peer name and a Security link", async () => {
    await notifyRecoveryReady({ userId: "u1", version: 2, peerId: "peer-a", peerName: "Ada", firstForVersion: true });
    await notifyRecoveryReady({ userId: "u1", version: 2, peerId: "peer-b", peerName: "Bo", firstForVersion: false });
    expect(created).toEqual([{
      userId: "u1",
      type: "recovery_ready",
      triggeredBy: "peer-a",
      triggeredByName: "Ada",
      content: "Your encrypted recovery vault was safely received by peer Ada. Tap to view your Recovery Link.",
      link: "/settings#security",
    }]);
  });
});
