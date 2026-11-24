import { describe, expect, it } from "vitest";
import { extractBlogBody, extractBlogTitle } from "../awareness";

const SUNO = "https://suno.com/s/KS8lagMkIcWbLe2F";

describe("blog title and body", () => {
  it("uses the first line as the title and removes it from the body", () => {
    const content = "My Poem\n\nLine one\nLine two";
    expect(extractBlogTitle(content)).toBe("My Poem");
    expect(extractBlogBody(content)).toBe("Line one\nLine two");
  });

  it("never turns a link into the title and keeps it in the body", () => {
    const content = `${SUNO}\n\nHark ye living, your ancestor speaks.\nDown hoary centuries`;
    expect(extractBlogTitle(content)).toBe("Hark ye living, your ancestor speaks.");
    expect(extractBlogBody(content)).toBe(content);
  });

  it("keeps a link that follows the title in the body", () => {
    const content = `Ancestor Song\n${SUNO}\nHark ye living`;
    expect(extractBlogTitle(content)).toBe("Ancestor Song");
    expect(extractBlogBody(content)).toBe(`${SUNO}\nHark ye living`);
  });

  it("falls back to Untitled when every line is a link", () => {
    expect(extractBlogTitle(SUNO)).toBe("Untitled");
    expect(extractBlogBody(SUNO)).toBe(SUNO);
  });
});
