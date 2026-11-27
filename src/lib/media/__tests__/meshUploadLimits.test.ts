import { describe, it, expect } from "vitest";
import { routeUploadFor, TORRENT_DISTRIBUTION_MAX_BYTES } from "../meshUploadLimits";

const MB = 1024 * 1024;

describe("routeUploadFor", () => {
  it("routes by the file's size as it is attached, keeping the torrent share within 50 MB", () => {
    expect(routeUploadFor(10 * MB, 0)).toBe("torrent");
    expect(routeUploadFor(TORRENT_DISTRIBUTION_MAX_BYTES, 0)).toBe("torrent");
    expect(routeUploadFor(51 * MB, 0)).toBe("media-coin");
    // A file that would take the post's torrent share over 50 MB goes by Media Coin.
    expect(routeUploadFor(20 * MB, 40 * MB)).toBe("media-coin");
    expect(routeUploadFor(10 * MB, 40 * MB)).toBe("torrent");
  });
});
