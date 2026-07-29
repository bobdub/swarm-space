import { describe, expect, it } from "vitest";
import { extractYoutubeVideoIds, firstYoutubeVideoId, youtubeEmbedUrl } from "../youtube";

describe("youtube link awareness", () => {
  it("extracts from youtu.be short links", () => {
    expect(extractYoutubeVideoIds("watch https://youtu.be/dQw4w9WgXcQ now")).toEqual(["dQw4w9WgXcQ"]);
  });

  it("extracts from watch?v= links", () => {
    expect(firstYoutubeVideoId("https://www.youtube.com/watch?v=abc123XYZ_-")).toBe("abc123XYZ_-");
  });

  it("extracts from shorts and embed links", () => {
    expect(firstYoutubeVideoId("https://youtube.com/shorts/SHORTID01")).toBe("SHORTID01");
    expect(firstYoutubeVideoId("https://www.youtube.com/embed/EMBEDID01")).toBe("EMBEDID01");
  });

  it("ignores non-youtube and malformed urls", () => {
    expect(extractYoutubeVideoIds("https://vimeo.com/12345 and http://")).toEqual([]);
    expect(firstYoutubeVideoId("no links at all")).toBeNull();
  });

  it("dedupes repeated ids and builds embed urls", () => {
    expect(
      extractYoutubeVideoIds("https://youtu.be/AAA111 https://www.youtube.com/watch?v=AAA111"),
    ).toEqual(["AAA111"]);
    expect(youtubeEmbedUrl("AAA111")).toBe("https://www.youtube.com/embed/AAA111");
  });
});
