import { describe, it, expect, beforeEach } from "vitest";
import type { Comment, Post } from "@/types";
import { createAccountExportStream } from "@/lib/utils/exporter";
import { importPersonalArchive } from "../archiveImport";
import { readZip } from "../zip";
import { parsePostMarkdown, renderPostMarkdown } from "../archiveFormat";

const ME = { id: "u-me", username: "mike", displayName: "Mike", publicKey: "pk", wrappedKeyRef: "w", createdAt: "2026-01-01T00:00:00Z" };
const post: Post & { _coinId: string } = {
  id: "post-1", author: "u-me", authorName: "Mike", type: "image", createdAt: "2026-03-04T05:06:07.000Z",
  content: "# Sunrise\n\nFirst light over the mesh.\n\nSecond paragraph.", tags: ["dawn", "mesh"], manifestIds: ["file-a"], _coinId: "coin-9",
};
const foreign: Post = { id: "post-x", author: "u-other", type: "text", createdAt: "2026-03-05T00:00:00.000Z", content: "not mine" };
const comments: Comment[] = [
  { id: "c1", postId: "post-1", author: "u-ada", authorName: "Ada", text: "Lovely!\nTwo lines.", createdAt: "2026-03-04T06:00:00.000Z" },
  { id: "c2", postId: "post-1", author: "u-me", authorName: "Mike", text: "Thanks", createdAt: "2026-03-04T07:00:00.000Z", parentId: "c1" },
];
const image = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

async function exportBytes(): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { stream, fileName } = await createAccountExportStream({ includePosts: true, includeMedia: true }, {
    dependencies: {
      loadPosts: async () => [post],
      loadComments: async () => comments,
      resolveAttachment: async (id) => id === "file-a"
        ? { manifest: { fileId: "file-a", chunks: [], mime: "image/png", size: image.length, originalName: "sun rise.png", createdAt: "2026-03-04T05:00:00Z" }, data: image.buffer.slice(0) }
        : null,
    },
  });
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); }
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
  return { bytes, fileName };
}

beforeEach(() => { localStorage.setItem("me", JSON.stringify(ME)); });

describe("personal archive", () => {
  it("exports markdown posts, media folder and README", async () => {
    const { bytes, fileName } = await exportBytes();
    expect(fileName).toMatch(/^swarm-archive-mike-\d{4}-\d{2}-\d{2}\.zip$/);
    const names = readZip(bytes).map((e) => e.name);
    expect(names).toContain("README.md");
    expect(names).toContain("posts/2026-03-04_post-1.md");
    expect(names).toContain("media/file-a-sun_rise.png");
    const md = new TextDecoder().decode(await readZip(bytes).find((e) => e.name.startsWith("posts/"))!.read());
    expect(md).toContain('title: "Sunrise"');
    expect(md).toContain('coin_id: "coin-9"');
    expect(md).toContain("![Attachment: sun rise.png](../media/file-a-sun_rise.png)");
    expect(md).toContain("## Conversation");
    expect(md).toContain("> **Mike** · 2026-03-04T07:00:00.000Z");
  });

  it("parses back exactly what it rendered", () => {
    const md = renderPostMarkdown(post, [{ path: "media/file-a-x.png", manifestId: "file-a", name: "x.png", mime: "image/png" }], comments);
    const parsed = parsePostMarkdown(md)!;
    expect(parsed.post.content).toBe(post.content);
    expect(parsed.post.tags).toEqual(["dawn", "mesh"]);
    expect(parsed.post._coinId).toBe("coin-9");
    expect(parsed.comments).toEqual([
      { ...comments[0] },
      { ...comments[1] },
    ].map((c) => ({ ...c, authorName: c.authorName })));
  });

  it("keeps local-only and paywall restrictions through a round trip", () => {
    const restricted: Post = {
      ...post, _localOnly: true, walled: true, wallCoinId: "coin-w", unlockCostTokenId: "tok", unlockCostTicker: "SWARM",
      unlockCostAmount: 3, unlockedBy: ["u-ada"],
    };
    const parsed = parsePostMarkdown(renderPostMarkdown(restricted, [], []))!;
    expect(parsed.post).toMatchObject({
      _localOnly: true, walled: true, wallCoinId: "coin-w", unlockCostTokenId: "tok", unlockCostTicker: "SWARM", unlockCostAmount: 3, unlockedBy: ["u-ada"],
    });
    const open = parsePostMarkdown(renderPostMarkdown(post, [], []))!;
    expect(open.post._localOnly).toBeUndefined();
    expect(open.post.walled).toBeUndefined();
  });

  it("imports own posts with re-encrypted media, skipping existing and foreign posts", async () => {
    const { bytes } = await exportBytes();
    const saved: Post[] = [];
    const savedComments: Comment[] = [];
    const stored: File[] = [];
    const result = await importPersonalArchive(bytes, {
      dependencies: {
        currentUserId: () => "u-me",
        hasPost: async () => false,
        savePost: async (p) => { saved.push(p); },
        hasComment: async () => false,
        saveComment: async (c) => { savedComments.push(c); },
        hasManifest: async () => false,
        storeMedia: async (f) => { stored.push(f); return "file-new"; },
        notifyChanged: () => {},
      },
    });
    expect(result).toMatchObject({ posts: 1, comments: 2, media: 1, mediaFailed: 0, skippedForeign: 0 });
    expect(saved[0]).toMatchObject({ id: "post-1", manifestIds: ["file-new"], _origin: "local", commentCount: 2 });
    expect(stored[0].type).toBe("image/png");
    expect(new Uint8Array(await stored[0].arrayBuffer())).toEqual(image);

    const again = await importPersonalArchive(bytes, {
      dependencies: {
        currentUserId: () => "u-other", hasPost: async () => false, savePost: async () => {}, hasComment: async () => false,
        saveComment: async () => {}, hasManifest: async () => false, storeMedia: async () => "x", notifyChanged: () => {},
      },
    });
    expect(again.posts).toBe(0);
    expect(again.skippedForeign).toBe(1);
    expect(again.warnings.join(" ")).toMatch(/different identity/);
    void foreign;
  });
});
