import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { StandaloneSwarmMesh } from "../swarmMesh.standalone";

type Result = { changed: boolean; complete: boolean };

/** A mesh with only the media-pull queue wired up; pulls finish on demand. */
function makeMesh() {
  const mesh = Object.create(StandaloneSwarmMesh.prototype) as StandaloneSwarmMesh & Record<string, unknown>;
  mesh.assetPulls = new Map();
  mesh.assetPullQueue = [];
  mesh.activeAssetPull = null;
  const started: string[] = [];
  const finish = new Map<string, (r: Result) => void>();
  mesh.pullManifestAndChunks = (id: string) => {
    started.push(id);
    return new Promise<Result>((resolve) => finish.set(id, resolve));
  };
  return { mesh, started, finish };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("mesh media pulls run one file at a time", () => {
  it("pulls files FIFO and shares duplicate asks", async () => {
    const { mesh, started, finish } = makeMesh();
    const a = mesh.ensureManifestAndChunks("a");
    const b = mesh.ensureManifestAndChunks("b");
    const c = mesh.ensureManifestAndChunks("c");
    const bAgain = mesh.ensureManifestAndChunks("b");
    expect(bAgain).toBe(b);

    await tick();
    expect(started).toEqual(["a"]);
    expect(mesh.getAssetPullState("a")).toBe("active");
    expect(mesh.getAssetPullState("b")).toBe("queued");

    finish.get("a")!({ changed: true, complete: true });
    await expect(a).resolves.toEqual({ changed: true, complete: true });
    await tick();
    expect(started).toEqual(["a", "b"]);

    finish.get("b")!({ changed: false, complete: false });
    await b;
    await tick();
    expect(started).toEqual(["a", "b", "c"]);
    finish.get("c")!({ changed: false, complete: true });
    await c;
    expect(mesh.getAssetPullState("c")).toBeNull();
  });

  it("lets media someone is opening go next without interrupting the current pull", async () => {
    const { mesh, started, finish } = makeMesh();
    void mesh.ensureManifestAndChunks("a");
    void mesh.ensureManifestAndChunks("b");
    void mesh.ensureManifestAndChunks("c");
    void mesh.ensureManifestAndChunks("viewed", undefined, { next: true });
    await tick();
    expect(started).toEqual(["a"]);

    finish.get("a")!({ changed: false, complete: true });
    await tick();
    await tick();
    expect(started).toEqual(["a", "viewed"]);
  });

  it("keeps the line moving when a pull throws", async () => {
    const { mesh, started } = makeMesh();
    let calls = 0;
    (mesh as Record<string, unknown>).pullManifestAndChunks = async (id: string) => {
      started.push(id);
      if (calls++ === 0) throw new Error("boom");
      return { changed: false, complete: true };
    };
    const a = mesh.ensureManifestAndChunks("a");
    const b = mesh.ensureManifestAndChunks("b");
    await expect(a).resolves.toEqual({ changed: false, complete: false });
    await expect(b).resolves.toEqual({ changed: false, complete: true });
    expect(started).toEqual(["a", "b"]);
  });
});
