import { describe, it, expect } from "vitest";
import type { Post } from "@/types";
import { dedupeMediaCoinPosts, mediaCoinContentKeyOf } from "../mediaCoinFeed";

const post = (id: string, author: string, createdAt: string, roots?: string[]): Post => ({
  id, author, authorName: author.toUpperCase(), type: "video", content: id, createdAt,
  ...(roots ? { mediaCoins: roots.map((r) => ({ merkleRoot: r, name: r, mime: "video/mp4", size: 1 })) } : {}),
});

describe("dedupeMediaCoinPosts", () => {
  it("keeps one post per content (the earliest) and names the others as supporters", () => {
    const posts = [
      post("p3", "carol", "2026-01-03T00:00:00Z", ["root-a"]),
      post("p1", "alice", "2026-01-01T00:00:00Z", ["root-a"]),
      post("p2", "bob", "2026-01-02T00:00:00Z", ["root-a"]),
      post("p4", "dave", "2026-01-04T00:00:00Z"),
    ];
    const out = dedupeMediaCoinPosts(posts);
    expect(out.map((p) => p.id)).toEqual(["p1", "p4"]);
    expect(out[0]._mediaSupporters?.sort()).toEqual(["BOB", "CAROL"]);
  });

  it("keys content by merkleRoot, ignoring order", () => {
    expect(mediaCoinContentKeyOf(post("x", "a", "", ["b", "a"]))).toBe("a|b");
    expect(mediaCoinContentKeyOf(post("y", "a", ""))).toBeNull();
  });
});
