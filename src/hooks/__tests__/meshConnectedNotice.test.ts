import { describe, it, expect, vi, beforeEach } from "vitest";

const success = vi.fn();
vi.mock("sonner", () => ({ toast: { success, error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() } }));

import { noteMeshPeerCount, resetMeshConnectedNotice } from "../useP2P";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Connected to the mesh toast", () => {
  beforeEach(() => { success.mockClear(); resetMeshConnectedNotice(); });

  it("waits for the first real peer instead of firing when signaling comes online", async () => {
    noteMeshPeerCount(0);
    await flush();
    expect(success).not.toHaveBeenCalled();
    noteMeshPeerCount(1);
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith("Connected to the mesh", expect.objectContaining({ id: "p2p-connected" }));
  });

  it("stays quiet as more peers join or a link drops and recovers", async () => {
    for (const count of [1, 2, 3, 0, 1, 4]) noteMeshPeerCount(count);
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    await flush();
    expect(success).toHaveBeenCalledTimes(1);
  });

  it("announces again after P2P is turned off and back on", async () => {
    noteMeshPeerCount(2);
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    resetMeshConnectedNotice();
    noteMeshPeerCount(1);
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(2));
  });
});
