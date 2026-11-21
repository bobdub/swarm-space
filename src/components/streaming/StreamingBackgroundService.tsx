import { useCallback, useEffect } from "react";
import { notifySystem } from "@/lib/notifications";
import { useP2PContext } from "@/contexts/P2PContext";
import { getAll, put } from "@/lib/store";
import type { Post } from "@/types";
import type { RecordingResult } from "@/hooks/useRecording";
import { saveRecordingBlob } from "@/lib/streaming/recordingStore";
import { getKnownRoom } from "@/lib/streaming/streamSync.standalone";

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
        void notifySystem({
          type: "system",
          title: "Live room recording was not saved.",
          content: "The replay could not be written to this device.",
        });
        return null;
      }
    },
    [announceContent],
  );

  const attachRecordingToStreamPosts = useCallback(
    async (roomId: string, recordingId: string): Promise<string | null> => {
      const postEntries = await getAll<Post>("posts");
      const streamPosts = postEntries.filter((post) => post.stream?.roomId === roomId);
      if (streamPosts.length === 0) return null;
      const endedAt = new Date().toISOString();
      // Only mark posts as ended if the room itself is already ended.
      // Recording can finalize mid-session (e.g. host toggling record);
      // those events must NOT terminate the live for all viewers.
      const knownRoom = getKnownRoom(roomId);
      const roomIsEnded = Boolean(
        knownRoom?.state === "ended" ||
          knownRoom?.broadcast?.state === "ended" ||
          knownRoom?.endedAt,
      );
      let updatedPostId: string | null = null;
      for (const post of streamPosts) {
        if (!post.stream) continue;
        if (post.stream.recordingId === recordingId) continue;
        const updatedPost: Post = {
          ...post,
          type: "stream",
          stream: {
            ...post.stream,
            // Preserve broadcast state unless the room is truly ended.
            broadcastState: roomIsEnded ? "ended" : post.stream.broadcastState,
            recordingId,
            endedAt: roomIsEnded ? (post.stream.endedAt ?? endedAt) : post.stream.endedAt ?? null,
          },
        };
        await put("posts", updatedPost);
        announceContent(updatedPost.id);
        broadcastPost(updatedPost);
        updatedPostId ??= updatedPost.id;
      }
      if (updatedPostId && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
      }
      return updatedPostId;
    },
    [announceContent, broadcastPost],
  );

  const attachRecordingWithRetry = useCallback(
    async (roomId: string, recordingId: string): Promise<string | null> => {
      const maxAttempts = 8;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const attached = await attachRecordingToStreamPosts(roomId, recordingId);
        if (attached) return attached;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 1_000);
        });
      }
      return null;
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
          const postId = await attachRecordingWithRetry(detail.roomId!, recordingId);
          await notifySystem(
            postId
              ? {
                  type: "system",
                  title: "Your live room replay is ready.",
                  content: "It is attached to the room's feed post.",
                  link: `/posts/${postId}`,
                  linkLabel: "View replay",
                }
              : {
                  type: "system",
                  title: "Live room recording saved.",
                  content: "The replay will show on the feed post once it finishes syncing.",
                },
          );
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