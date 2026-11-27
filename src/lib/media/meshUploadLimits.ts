/**
 * Mesh-calibrated upload limits — the single source for every size cap.
 *
 * Posts travel peer to peer over WebRTC data channels with no CDN relay.
 * Two carriers share the work:
 *
 *  - Torrent distribution (many peers swarm the chunks) is comfortable up
 *    to ~50 MB of media per post. Whether it can go higher is a matter of
 *    peer count and network size, measured separately.
 *  - Media Coin courier mode (one coin carries the content on its own,
 *    one hop at a time, paced) takes posts above that, up to 500 MB per
 *    pass. 1 GB+ waits for real-mesh measurements; at a typical
 *    1-4 MB/s peer link, 500 MB is ~2-8 minutes per hop.
 *
 * A post holds at most five uploads and 500 MB in total. When all of a
 * post's media is 50 MB or less it uses torrent distribution; above that
 * the whole post goes by Media Coin.
 */
export const TORRENT_DISTRIBUTION_MAX_BYTES = 50 * 1024 * 1024;

/** Largest content one Media Coin pass carries (first step; see above). */
export const MEDIA_COIN_PASS_MAX_BYTES = 500 * 1024 * 1024;

/** Most uploads one post can hold. */
export const POST_UPLOAD_MAX_FILES = 5;

/** Total upload space across every file in one post. */
export const POST_UPLOAD_TOTAL_LIMIT_BYTES = 500 * 1024 * 1024;

/**
 * The torrent-friendly size. Long audio is compressed to fit under it
 * (audioTranscode) so it can still travel by torrent.
 */
export const MESH_POST_UPLOAD_LIMIT_BYTES = TORRENT_DISTRIBUTION_MAX_BYTES;

export type PostDistribution = "torrent" | "media-coin";

/** How a post's media travels: torrent at 50 MB or less, Media Coin above. */
export function postDistributionFor(totalMediaBytes: number): PostDistribution {
  return totalMediaBytes > TORRENT_DISTRIBUTION_MAX_BYTES ? "media-coin" : "torrent";
}

/** Human label for a byte limit, e.g. "25 MB" or "1 GB". */
export function formatUploadLimit(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export const VIDEO_TRANSCODE_WAIT_TOOLTIP =
  "This video will wait to be transcoded until others complete, you can still view it locally";
