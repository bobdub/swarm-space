import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const contents = { postIds: ["post-1"], commentIds: ["c1"], manifestIds: ["file-a"], chunkRefs: ["ch-1"] };
const clearArchivedLocal = vi.fn(async () => ({ removed: 4, freedBytes: 2048 }));

vi.mock("@/lib/storage/offload", () => ({
  estimateArchivedBytes: vi.fn(async () => 2048),
  clearArchivedLocal: (...args: unknown[]) => clearArchivedLocal(...(args as [])),
}));
vi.mock("@/lib/utils/exporter", () => ({
  createAccountExportStream: vi.fn(async () => ({
    fileName: "swarm-archive.zip",
    stream: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } }),
    summary: {
      generatedAt: "2026-11-27T00:00:00Z",
      selection: { includePosts: true, includeMedia: true },
      counts: { posts: 1, comments: 1, attachments: 1, files: 3 },
      attachments: [],
      contents,
      warnings: [],
    },
  })),
}));

import { AccountExportModal } from "../AccountExportModal";

beforeEach(() => {
  clearArchivedLocal.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:zip");
  URL.revokeObjectURL = vi.fn();
});

describe("Free up space in the exporter", () => {
  it("stays locked until the zip is downloaded, then clears only what the zip holds", async () => {
    render(<AccountExportModal defaultOpen />);
    fireEvent.click(screen.getByRole("button", { name: /start export/i }));

    const freeUp = await screen.findByRole("button", { name: /free up space/i });
    await waitFor(() => expect(screen.getByText("Download your zip first.")).toBeTruthy());
    expect(freeUp).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("link", { name: /download archive/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /free up space/i })).toHaveProperty("disabled", false));
    expect(clearArchivedLocal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /free up space/i }));
    fireEvent.click(screen.getByRole("button", { name: /clear from this device/i }));
    await waitFor(() => expect(clearArchivedLocal).toHaveBeenCalledWith(contents));
    expect(await screen.findByText(/Removed 4 items from this device/)).toBeTruthy();
  });
});
