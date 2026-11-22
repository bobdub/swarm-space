import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { ab2b64Yielding, LARGE_WORK_SLICE_BYTES } from "../torrentSwarm.standalone";

function wholeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

describe("large-file base64 without one long task", () => {
  it("matches whole-buffer base64 exactly, whatever the length", async () => {
    for (const extra of [0, 1, 2]) {
      const bytes = new Uint8Array(LARGE_WORK_SLICE_BYTES * 2 + 1234 + extra);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 255;
      expect(await ab2b64Yielding(bytes)).toBe(wholeBase64(bytes));
      expect(await ab2b64Yielding(bytes.buffer)).toBe(wholeBase64(bytes));
    }
  });

  it("yields to the event loop between slices", async () => {
    const bytes = new Uint8Array(LARGE_WORK_SLICE_BYTES * 3);
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 0);
    await ab2b64Yielding(bytes);
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
  });
});
