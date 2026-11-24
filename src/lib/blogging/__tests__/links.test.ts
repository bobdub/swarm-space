import { describe, expect, it } from "vitest";
import { parseSunoLink, prettyUrlLabel, splitLinks, urlOnlyLine } from "../links";

describe("blog links", () => {
  it("splits text and urls, dropping trailing punctuation", () => {
    expect(splitLinks("Listen: https://suno.com/s/KS8lagMkIcWbLe2F. Enjoy")).toEqual([
      { kind: "text", text: "Listen: " },
      { kind: "url", text: "https://suno.com/s/KS8lagMkIcWbLe2F", href: "https://suno.com/s/KS8lagMkIcWbLe2F" },
      { kind: "text", text: ". Enjoy" },
    ]);
  });

  it("keeps balanced brackets in urls", () => {
    const [piece] = splitLinks("https://en.wikipedia.org/wiki/Foo_(bar)");
    expect(piece).toMatchObject({ kind: "url", text: "https://en.wikipedia.org/wiki/Foo_(bar)" });
  });

  it("spots link-only lines", () => {
    expect(urlOnlyLine("  https://suno.com/s/KS8lagMkIcWbLe2F  ")).toBe("https://suno.com/s/KS8lagMkIcWbLe2F");
    expect(urlOnlyLine("www.example.com")).toBe("https://www.example.com");
    expect(urlOnlyLine("Hark ye living https://x.com")).toBeNull();
  });

  it("labels links in their original case", () => {
    expect(prettyUrlLabel("https://suno.com/s/KS8lagMkIcWbLe2F")).toBe("suno.com/s/KS8lagMkIcWbLe2F");
  });

  it("recognises suno links", () => {
    expect(parseSunoLink("https://suno.com/s/KS8lagMkIcWbLe2F")).toEqual({
      kind: "share",
      href: "https://suno.com/s/KS8lagMkIcWbLe2F",
    });
    expect(parseSunoLink("https://suno.com/song/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b")).toMatchObject({
      kind: "song",
      embedUrl: "https://suno.com/embed/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
    });
    expect(parseSunoLink("https://example.com/song")).toBeNull();
  });
});
