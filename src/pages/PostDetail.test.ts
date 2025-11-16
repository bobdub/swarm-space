import { describe, expect, it } from "bun:test";
import { shouldHighlightPost } from "./PostDetail";

describe("shouldHighlightPost", () => {
  it("skips highlighting when there is no target post", () => {
    expect(shouldHighlightPost(false, null, null)).toBe(false);
    expect(shouldHighlightPost(true, "123", undefined)).toBe(false);
  });

  it("allows the first highlight after navigation", () => {
    expect(shouldHighlightPost(false, null, "post-1")).toBe(true);
  });

  it("suppresses repeated highlights for the same post", () => {
    expect(shouldHighlightPost(true, "post-1", "post-1")).toBe(false);
  });

  it("re-enables highlighting when the permalink changes", () => {
    expect(shouldHighlightPost(true, "post-1", "post-2")).toBe(true);
  });
});
