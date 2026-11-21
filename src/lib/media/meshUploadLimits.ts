/**
 * Mesh-calibrated upload limits.
 *
 * Posts travel peer to peer over WebRTC data channels with no CDN relay,
 * and every peer that fetches a file holds its chunks in memory while it
 * reassembles them. 50 MB keeps a single post attachment within what the
 * mesh carries reliably (manual re-seed tops out at 15 MB, personal-server
 * chunks at 20 MiB) while leaving headroom for compressed videos.
 */
export const MESH_POST_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

/** Human label for a byte limit, e.g. "25 MB" or "1 GB". */
export function formatUploadLimit(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export const VIDEO_TRANSCODE_WAIT_TOOLTIP =
  "This video will wait to be transcoded until others complete, you can still view it locally";
