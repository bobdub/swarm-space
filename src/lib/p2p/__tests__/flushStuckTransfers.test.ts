import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { StandaloneSwarmMesh } from "../swarmMesh.standalone";

type Row = { fileId: string; percent: number; prefs: { paused: boolean; ignored: boolean; hostFirst: boolean } };
const row = (fileId: string, percent: number, ignored = false): Row => ({
  fileId, percent, prefs: { paused: false, ignored, hostFirst: false },
});

function makeMesh(rows: Row[], undeletable: string[] = []) {
  const mesh = Object.create(StandaloneSwarmMesh.prototype) as StandaloneSwarmMesh & Record<string, unknown>;
  mesh.assetPulls = new Map();
  mesh.assetPullQueue = [];
  mesh.activeAssetPull = null;
  mesh.assetRetryTimers = new Map();
  mesh.assetRetryAttempts = new Map();
  mesh.torrentSwarmInstance = null;
  mesh.pullManifestAndChunks = () => new Promise(() => {}); // never finishes
  mesh.getFileTransferList = async () => rows;
  const deleted: string[] = [];
  mesh.deleteFile = async (id: string) => {
    if (undeletable.includes(id)) return false;
    deleted.push(id);
    return true;
  };
  return { mesh, deleted };
}

describe("flushStuckTransfers", () => {
  it("drops waiting files, keeps the moving, finished, ignored and engraved ones", async () => {
    const { mesh, deleted } = makeMesh(
      [row("moving", 40), row("q1", 0), row("q2", 10), row("retry", 0), row("done", 100), row("ign", 0, true), row("coin", 0)],
      ["coin"],
    );
    void mesh.ensureManifestAndChunks("moving");
    const q1 = mesh.ensureManifestAndChunks("q1");
    void mesh.ensureManifestAndChunks("q2");
    (mesh.assetRetryTimers as Map<string, ReturnType<typeof setTimeout>>).set("retry", setTimeout(() => {}, 1e9));

    const result = await mesh.flushStuckTransfers();

    expect(deleted).toEqual(["q1", "q2", "retry"]);
    expect(result).toEqual({ flushed: 3, kept: 2 });
    expect(mesh.getAssetPullState("moving")).toBe("active");
    expect(mesh.getAssetPullState("q1")).toBeNull();
    await expect(q1).resolves.toEqual({ changed: false, complete: false });
    expect((mesh.assetRetryTimers as Map<string, unknown>).has("retry")).toBe(false);
  });
});
