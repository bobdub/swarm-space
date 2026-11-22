import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { StandaloneSwarmMesh } from "../swarmMesh.standalone";

type Row = { fileId: string; percent: number; prefs: { paused: boolean; ignored: boolean; hostFirst: boolean } };
const row = (fileId: string, percent: number): Row => ({
  fileId, percent, prefs: { paused: false, ignored: false, hostFirst: false },
});
const tick = () => new Promise((r) => setTimeout(r, 0));

function makeMesh(rows: Row[], opts: { undeletable?: string[]; ignored?: string[] } = {}) {
  const mesh = Object.create(StandaloneSwarmMesh.prototype) as StandaloneSwarmMesh & Record<string, unknown>;
  mesh.assetPulls = new Map();
  mesh.assetPullQueue = [];
  mesh.activeAssetPull = null;
  mesh.assetRetryTimers = new Map();
  mesh.assetRetryAttempts = new Map();
  mesh.pendingAssetQueue = new Map();
  mesh.connections = new Map([["peer", {}]]);
  mesh.fileSeeders = new Map();
  mesh.peerId = "me";
  mesh.torrentSwarmInstance = null;
  mesh.pullManifestAndChunks = () => new Promise(() => {}); // never finishes
  mesh.getFileTransferList = async () => rows;
  mesh.getFilePref = (id: string) => ({ paused: false, ignored: (opts.ignored ?? []).includes(id), hostFirst: false });
  mesh.prioritizeManifests = async (ids: string[]) => ids;
  mesh.emitTransferProgress = () => {};
  const deleted: string[] = [];
  mesh.deleteFile = async (id: string) => {
    if ((opts.undeletable ?? []).includes(id)) return false;
    deleted.push(id);
    return true;
  };
  return { mesh, deleted };
}

describe("flushStuckTransfers", () => {
  beforeEach(() => localStorage.clear());

  it("drops waiting files, keeps the moving, finished, ignored and engraved ones", async () => {
    const { mesh, deleted } = makeMesh(
      [row("moving", 40), row("q1", 0), row("retry", 0), row("done", 100), row("ign", 0), row("coin", 0)],
      { undeletable: ["coin"], ignored: ["ign"] },
    );
    void mesh.ensureManifestAndChunks("moving");
    const q1 = mesh.ensureManifestAndChunks("q1");
    void mesh.ensureManifestAndChunks("noManifestYet"); // queued, not in the stored list
    (mesh.assetRetryTimers as Map<string, ReturnType<typeof setTimeout>>).set("retry", setTimeout(() => {}, 1e9));

    const result = await mesh.flushStuckTransfers();

    expect(deleted.sort()).toEqual(["noManifestYet", "q1", "retry"]);
    expect(result).toEqual({ flushed: 3, kept: 2 });
    expect(mesh.getAssetPullState("moving")).toBe("active");
    expect(mesh.getAssetPullState("noManifestYet")).toBeNull();
    await expect(q1).resolves.toEqual({ changed: false, complete: false });
    expect((mesh.assetRetryTimers as Map<string, unknown>).has("retry")).toBe(false);
  });

  it("flushed post media is not re-queued by post sync or retries", async () => {
    const { mesh } = makeMesh([row("moving", 40)]);
    void mesh.ensureManifestAndChunks("moving");
    // Post sync is waiting on "p1" behind the moving file.
    const sync = (mesh as unknown as { ensurePostAssets: (ids: string[]) => Promise<void> }).ensurePostAssets(["p1"]);
    await tick();
    expect(mesh.getAssetPullState("p1")).toBe("queued");

    await mesh.flushStuckTransfers();
    await sync;
    await tick();

    expect((mesh.assetRetryTimers as Map<string, unknown>).has("p1")).toBe(false);
    // A later sync of the same post skips it.
    await (mesh as unknown as { ensurePostAssets: (ids: string[]) => Promise<void> }).ensurePostAssets(["p1"]);
    expect(mesh.getAssetPullState("p1")).toBeNull();
  });
});
