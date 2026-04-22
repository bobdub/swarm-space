import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useP2PContext } from "@/contexts/P2PContext";
import { getAll, put } from "@/lib/store";
import type { Post } from "@/types";
import type { RecordingResult } from "@/hooks/useRecording";
import { saveRecordingBlob } from "@/lib/streaming/recordingStore";

/**
 * Headless service that mirrors the end-of-stream side effects that used
 * to live inside <StreamingRoomTray />. The legacy tray UI is gone; this
 * component keeps the recording → feed-post archival pipeline alive so
 * recordings continue to attach to promoted posts even with the new
 * Brain chat surface.
 *
 * Listens for: `stream-recording-finalized`
 * Side effects: persists the recording blob, seeds it to the mesh, and
 * patches every Post whose `stream.roomId` matches.
 */
export function StreamingBackgroundService(): null {
  const { broadcastPost, announceContent } = useP2PContext();

  const persistRecordingBlobForRoom = useCallback(
    async (roomId: string, recording?: RecordingResult): Promise<string | null> => {
      if (!recording || recording.blob.size <= 0) return null;
      const recordingId = `rec-${roomId}-${Date.now()}`;
      try {
        await saveRecordingBlob(recordingId, recording.blob);
        try {
          const file = new File([recording.blob], `${recordingId}.webm`, {
            type: recording.blob.type || "video/webm",
          });
          announceContent(recordingId);
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("torrent-seed-file", {
                detail: { fileId: recordingId, file, fileName: `${recordingId}.webm` },
              }),
            );
          }
        } catch (seedError) {
          console.warn("[StreamingBackgroundService] seed failed:", seedError);
        }
        return recordingId;
      } catch (error) {
        console.error("[StreamingBackgroundService] save failed:", error);
        toast.error("Failed to save recording");
        return null;
      }
    },
    [announceContent],
  );

  const attachRecordingToStreamPosts = useCallback(
    async (roomId: string, recordingId: string): Promise<boolean> => {
      const postEntries = await getAll<Post>("posts");
      const streamPosts = postEntries.filter((post) => post.stream?.roomId === roomId);
      if (streamPosts.length === 0) return false;
      const endedAt = new Date().toISOString();
      let updatedAny = false;
      for (const post of streamPosts) {
        if (!post.stream) continue;
        if (post.stream.recordingId === recordingId) continue;
        const updatedPost: Post = {
          ...post,
          type: "stream",
          stream: {
            ...post.stream,
            broadcastState: "ended",
            recordingId,
            endedAt: post.stream.endedAt ?? endedAt,
          },
        };
        await put("posts", updatedPost);
        announceContent(updatedPost.id);
        broadcastPost(updatedPost);
        updatedAny = true;
      }
      if (updatedAny && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
      }
      return updatedAny;
    },
    [announceContent, broadcastPost],
  );

  const attachRecordingWithRetry = useCallback(
    async (roomId: string, recordingId: string): Promise<boolean> => {
      const maxAttempts = 8;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const attached = await attachRecordingToStreamPosts(roomId, recordingId);
        if (attached) return true;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 1_000);
        });
      }
      return false;
    },
    [attachRecordingToStreamPosts],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleRecordingFinalized = (event: Event) => {
      const detail = (event as CustomEvent<{ roomId?: string; recording?: RecordingResult }>).detail;
      if (!detail?.roomId || !detail.recording?.blob.size) return;
      void (async () => {
        const recordingId = await persistRecordingBlobForRoom(detail.roomId!, detail.recording);
        if (!recordingId) return;
        try {
          const attached = await attachRecordingWithRetry(detail.roomId!, recordingId);
          if (attached) toast.success("Replay attached to feed post");
          else toast.warning("Recording saved, still syncing replay metadata");
        } catch (error) {
          console.error("[StreamingBackgroundService] attach failed:", error);
        }
      })();
    };
    window.addEventListener("stream-recording-finalized", handleRecordingFinalized);
    return () => {
      window.removeEventListener("stream-recording-finalized", handleRecordingFinalized);
    };
  }, [attachRecordingWithRetry, persistRecordingBlobForRoom]);

  return null;
}

export default StreamingBackgroundService;