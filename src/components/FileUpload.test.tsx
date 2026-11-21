import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

const resolvers: Array<() => void> = [];
const started: string[] = [];

vi.mock("@/lib/fileEncryption", () => ({
  genFileKey: vi.fn(async () => ({})),
  chunkAndEncryptFile: vi.fn((file: File) => {
    started.push(file.name);
    return new Promise((resolve) => {
      resolvers.push(() => resolve({ fileId: `id-${file.name}`, fileName: file.name }));
    });
  }),
}));
vi.mock("@/contexts/P2PContext", () => ({
  useP2PContext: () => ({ announceContent: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FileUpload } from "./FileUpload";
import { toast } from "sonner";
import { MESH_POST_UPLOAD_LIMIT_BYTES, VIDEO_TRANSCODE_WAIT_TOOLTIP } from "@/lib/media/meshUploadLimits";

function video(name: string, size = 1024) {
  const f = new File([new Uint8Array(8)], name, { type: "video/mp4" });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function drop(container: HTMLElement, files: File[]) {
  const zone = container.querySelector('[role="button"]')!;
  fireEvent.drop(zone, { dataTransfer: { files } });
}

describe("FileUpload queue", () => {
  beforeEach(() => {
    resolvers.length = 0;
    started.length = 0;
    vi.mocked(toast.error).mockClear();
    URL.createObjectURL = vi.fn(() => "blob:local-preview");
    URL.revokeObjectURL = vi.fn();
    // jsdom never loads media; report an error so dimension probing settles.
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true,
      set(this: HTMLMediaElement) {
        queueMicrotask(() => this.onerror?.(new Event("error")));
      },
      get() { return ""; },
    });
  });

  it("shows the mesh limit and rejects oversized files", () => {
    const { container } = render(
      <TooltipProvider>
        <FileUpload onFilesReady={vi.fn()} maxFileSize={MESH_POST_UPLOAD_LIMIT_BYTES} />
      </TooltipProvider>
    );
    expect(screen.getByText(/up to 50 MB each \(mesh limit\)/)).toBeInTheDocument();
    drop(container, [video("huge.mp4", 60 * 1024 * 1024)]);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("limited to 50 MB"));
    expect(started).toEqual([]);
  });

  it("processes one video at a time; waiting videos play locally with a tooltip", async () => {
    const onReady = vi.fn();
    const onEncrypting = vi.fn();
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <FileUpload
          onFilesReady={onReady}
          onEncryptingChange={onEncrypting}
          maxFileSize={MESH_POST_UPLOAD_LIMIT_BYTES}
        />
      </TooltipProvider>
    );

    drop(container, [video("one.mp4")]);
    drop(container, [video("two.mp4")]);

    await waitFor(() => expect(started).toEqual(["one.mp4"]));
    // the second video waits, but already has a local preview player
    const badge = await screen.findByText("Waiting to transcode");
    expect(container.querySelectorAll("video")).toHaveLength(2);
    expect(onEncrypting).toHaveBeenCalledWith(true);

    // explained by a tooltip, never a toast
    fireEvent.focus(badge);
    expect((await screen.findAllByText(VIDEO_TRANSCODE_WAIT_TOOLTIP)).length).toBeGreaterThan(0);
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => { resolvers[0](); });
    await waitFor(() => expect(started).toEqual(["one.mp4", "two.mp4"]));
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Waiting to transcode")).toBeNull();

    await act(async () => { resolvers[1](); });
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2));
    expect(onEncrypting).toHaveBeenLastCalledWith(false);
  });
});
