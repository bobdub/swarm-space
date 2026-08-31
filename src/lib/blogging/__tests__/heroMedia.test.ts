import { describe, it, expect, vi, beforeEach } from "vitest";

const manifests = new Map<string, unknown>();

vi.mock("@/lib/store", () => ({
  get: vi.fn(async (_store: string, id: string) => manifests.get(id) ?? null),
}));

vi.mock("@/lib/fileEncryption", () => ({
  importFileKey: vi.fn(async () => ({}) as CryptoKey),
  decryptAndReassembleFile: vi.fn(async (m: { mime: string }) => new Blob(["x"], { type: m.mime })),
}));

vi.mock("@/lib/pipeline/deliveryTelemetry", () => ({
  reportDeliveryEvent: vi.fn(),
}));

import { loadBlogHeroImage } from "../heroMedia";

function makeManifest(fileId: string, mime: string) {
  return { fileId, mime, size: 10, originalName: fileId, fileKey: "k", chunks: [{ id: "c1" }] };
}

describe("loadBlogHeroImage", () => {
  beforeEach(() => {
    manifests.clear();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:hero") as unknown as typeof URL.createObjectURL;
  });

  it("resolves a video manifest as a video hero", async () => {
    manifests.set("v1", makeManifest("v1", "video/mp4"));
    const res = await loadBlogHeroImage(["v1"], async () => null);
    expect(res.hero).toEqual({ url: "blob:hero", kind: "video", mime: "video/mp4" });
    expect(res.heroUrl).toBe("blob:hero");
  });

  it("resolves an image manifest as an image hero", async () => {
    manifests.set("i1", makeManifest("i1", "image/png"));
    const res = await loadBlogHeroImage(["i1"], async () => null);
    expect(res.hero?.kind).toBe("image");
  });

  it("skips unsupported types", async () => {
    manifests.set("p1", makeManifest("p1", "application/pdf"));
    const res = await loadBlogHeroImage(["p1"], async () => null);
    expect(res.hero).toBeNull();
  });
});
