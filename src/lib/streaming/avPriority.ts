/**
 * A/V Priority — bias the shared WebRTCManager toward voice/video
 * smoothness over peripheral data when a live-stream post is being
 * watched. Scoped to live-stream posts only; the broader Brain
 * universe is unaffected.
 */
import { getWebRTCManager } from "@/lib/webrtc/manager";

export type AvPriorityMode = "live" | "world";

/**
 * Apply content hints to the current local senders so the browser's
 * encoder favors speech intelligibility (audio) and motion clarity
 * (video) when in a live call. Safe no-op if the manager has no
 * active local stream or the browser lacks `contentHint`.
 */
export function applyLiveAvPriority(
  userId: string | undefined,
  username: string | undefined,
  mode: AvPriorityMode,
): void {
  if (!userId || !username) return;
  try {
    const manager = getWebRTCManager(userId, username);
    const anyMgr = manager as unknown as {
      getLocalStream?: () => MediaStream | null;
      localStream?: MediaStream | null;
    };
    const stream: MediaStream | null =
      (typeof anyMgr.getLocalStream === "function" ? anyMgr.getLocalStream() : null) ??
      anyMgr.localStream ??
      null;
    if (!stream) return;
    for (const track of stream.getAudioTracks()) {
      try {
        (track as MediaStreamTrack & { contentHint?: string }).contentHint =
          mode === "live" ? "speech" : "";
      } catch {
        /* older browsers — ignore */
      }
    }
    for (const track of stream.getVideoTracks()) {
      try {
        (track as MediaStreamTrack & { contentHint?: string }).contentHint =
          mode === "live" ? "motion" : "";
      } catch {
        /* older browsers — ignore */
      }
    }
  } catch {
    /* manager unavailable — ignore */
  }
}