import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStreaming } from "@/hooks/useStreaming";
import { useAuth } from "@/hooks/useAuth";
import type { Post } from "@/types";
import { getAll } from "@/lib/store";
import { toast } from "sonner";
import { Loader2, Lock, PlayCircle, Radio, Users, Clock } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { getKnownRoom, requestRoom as requestRoomFromPeers } from "@/lib/streaming/streamSync.standalone";
import { getRecordingBlob } from "@/lib/streaming/recordingStore";

interface StreamPostCardContentProps {
  post: Post;
}

const RECORDING_PROCESSING_WINDOW_MS = 180_000;

export function StreamPostCardContent({ post }: StreamPostCardContentProps): JSX.Element {
  const stream = post.stream ?? null;
  const { roomsById, connect, joinRoom, refreshRoom } = useStreaming();
  const { user } = useAuth();
  const [isJoining, setIsJoining] = useState(false);
  const [hydrateAttempted, setHydrateAttempted] = useState(false);
  const [resolvedRecordingId, setResolvedRecordingId] = useState<string | null>(
    stream?.recordingId ?? null,
  );
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingProcessing, setRecordingProcessing] = useState(false);
  const [transferProgress, setTransferProgress] = useState<{
    fileName: string;
    percent: number;
    receivedChunks: number;
    totalChunks: number;
    complete: boolean;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const room = stream ? roomsById[stream.roomId] : undefined;

  useEffect(() => {
    if (!stream) return;
    if (stream.broadcastState === "ended") return;
    if (room) return;
    if (hydrateAttempted) return;
    setHydrateAttempted(true);
    const knownRoom = getKnownRoom(stream.roomId);
    if (knownRoom) {
      refreshRoom(stream.roomId).catch(() => {});
      return;
    }
    requestRoomFromPeers(stream.roomId);
    refreshRoom(stream.roomId).catch(() => {});
  }, [stream, room, refreshRoom, hydrateAttempted]);

  const applyRecordingBlob = useCallback((blob: Blob) => {
    if (!blob.size) return;
    const url = URL.createObjectURL(blob);
    setRecordingUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return url;
    });
    setRecordingProcessing(false);
  }, []);

  useEffect(() => {
    return () => {
      setRecordingUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
    };
  }, []);

  useEffect(() => {
    const incomingRecordingId = stream?.recordingId ?? room?.recording?.recordingId ?? null;
    if (incomingRecordingId) {
      setResolvedRecordingId(incomingRecordingId);
    }
  }, [stream?.recordingId, room?.recording?.recordingId]);

  // Load recording blob from IndexedDB when ended
  useEffect(() => {
    const recordingId = resolvedRecordingId ?? stream?.recordingId ?? room?.recording?.recordingId ?? null;
    if (!recordingId) return;
    const isEnded = stream.broadcastState === "ended" || room?.state === "ended";
    if (!isEnded) return;

    let cancelled = false;
    getRecordingBlob(recordingId).then((blob) => {
      if (cancelled || !blob) return;
      applyRecordingBlob(blob);
    });

    return () => {
      cancelled = true;
    };
  }, [resolvedRecordingId, stream?.recordingId, stream?.broadcastState, room?.recording?.recordingId, room?.state, applyRecordingBlob]);

  const promotedLabel = useMemo(() => {
    if (!stream?.promotedAt) return null;
    try {
      return formatDistanceToNow(new Date(stream.promotedAt), { addSuffix: true });
    } catch {
      return null;
    }
  }, [stream?.promotedAt]);

  const endedLabel = useMemo(() => {
    if (!stream) return null;
    const endedAt = stream.endedAt ?? room?.endedAt;
    if (!endedAt) return null;
    try {
      return formatDistanceToNow(new Date(endedAt), { addSuffix: true });
    } catch {
      return null;
    }
  }, [stream, room?.endedAt]);

  const visibility = stream ? (room?.visibility ?? stream.visibility) : "public";
  const requiresInvite = visibility === "invite-only";
  const participantCount = room?.participants.length ?? 0;
  const broadcastState =
    stream?.broadcastState === "ended" || room?.state === "ended"
      ? "ended"
      : stream?.broadcastState ?? "ended";
  const isEnded = broadcastState === "ended";
  const isLive = !isEnded && (room ? room.state === "live" : broadcastState === "broadcast");
  const normalizedUsername = user?.username?.toLowerCase();
  const isParticipant = Boolean(room?.participants.some((participant) => participant.userId === user?.id));
  const isInvited = Boolean(
    requiresInvite &&
      normalizedUsername &&
      room?.invites.some(
        (invite) =>
          invite.handle?.toLowerCase() === normalizedUsername &&
          !invite.revokedAt,
      ),
  );
  const canJoin = !requiresInvite || isParticipant || isInvited;
  const summaryId = stream?.summaryId ?? room?.summary?.summaryId ?? null;
  const hasRecording = Boolean(resolvedRecordingId ?? stream?.recordingId ?? room?.recording?.recordingId);
  const title = stream?.title || post.content || "Live room";

  // Listen for background recording finalized event to re-check for recording
  const retryLoadRecording = useCallback(async () => {
    if (!stream?.roomId) return;

    let recordingId =
      resolvedRecordingId ?? stream?.recordingId ?? room?.recording?.recordingId ?? null;

    if (!recordingId) {
      const localPosts = await getAll<Post>("posts");
      const matched = localPosts.find(
        (entry) =>
          entry.stream?.roomId === stream.roomId &&
          entry.stream?.recordingId &&
          entry.stream.broadcastState === "ended",
      );
      recordingId = matched?.stream?.recordingId ?? null;
    }

    if (!recordingId) return;

    setResolvedRecordingId(recordingId);
    const blob = await getRecordingBlob(recordingId);
    if (!blob) return;
    applyRecordingBlob(blob);
  }, [applyRecordingBlob, resolvedRecordingId, room?.recording?.recordingId, stream?.recordingId, stream?.roomId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleFinalized = (e: Event) => {
      const detail = (
        e as CustomEvent<{ roomId?: string; recording?: { blob?: Blob } }>
      ).detail;
      if (detail?.roomId && stream?.roomId && detail.roomId === stream.roomId) {
        setRecordingProcessing(true);
        if (detail.recording?.blob?.size) {
          applyRecordingBlob(detail.recording.blob);
        }
        void retryLoadRecording();
      }
    };

    const handlePostsUpdated = () => {
      // Small delay to let IndexedDB writes settle
      setTimeout(() => {
        void retryLoadRecording();
      }, 500);
    };

    window.addEventListener("stream-recording-finalized", handleFinalized);
    window.addEventListener("p2p-posts-updated", handlePostsUpdated);
    return () => {
      window.removeEventListener("stream-recording-finalized", handleFinalized);
      window.removeEventListener("p2p-posts-updated", handlePostsUpdated);
    };
  }, [applyRecordingBlob, retryLoadRecording, stream?.roomId]);

  // Detect when stream just ended without recording — may be processing in background
  useEffect(() => {
    if (!isEnded || hasRecording || recordingUrl) {
      setRecordingProcessing(false);
      return;
    }

    const endedAtTs = stream?.endedAt ? new Date(stream.endedAt).getTime() : Date.now();
    const endedAgo = Date.now() - endedAtTs;
    if (endedAgo >= RECORDING_PROCESSING_WINDOW_MS) {
      setRecordingProcessing(false);
      return;
    }

    setRecordingProcessing(true);
    void retryLoadRecording();

    const poll = window.setInterval(() => {
      void retryLoadRecording();
    }, 2_000);

    const timeout = window.setTimeout(
      () => setRecordingProcessing(false),
      RECORDING_PROCESSING_WINDOW_MS - endedAgo,
    );

    return () => {
      window.clearInterval(poll);
      window.clearTimeout(timeout);
    };
  }, [hasRecording, isEnded, recordingUrl, retryLoadRecording, stream?.endedAt]);

  // Listen for content-transfer-progress events to show download progress
  useEffect(() => {
    if (typeof window === "undefined" || !isEnded || !recordingProcessing) return;

    const handleProgress = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      // Accept progress for any manifest related to this post's recordings
      // or for the recording blob itself
      setTransferProgress({
        fileName: detail.fileName ?? "Recording",
        percent: detail.percent ?? 0,
        receivedChunks: detail.receivedChunks ?? 0,
        totalChunks: detail.totalChunks ?? 0,
        complete: detail.complete ?? false,
      });
      if (detail.complete) {
        void retryLoadRecording();
      }
    };

    window.addEventListener("content-transfer-progress", handleProgress);
    return () => {
      window.removeEventListener("content-transfer-progress", handleProgress);
    };
  }, [isEnded, recordingProcessing, retryLoadRecording]);

  if (!stream) {
    return (
      <div className="space-y-3">
        <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground/75">
          {post.content}
        </div>
      </div>
    );
  }

  const handleJoin = async () => {
    if (!user) {
      toast.error("Sign in to join live rooms");
      return;
    }
    if (requiresInvite && !canJoin) {
      toast.error("This stream is invite-only");
      return;
    }

    setIsJoining(true);
    try {
      await connect();
      await joinRoom(stream.roomId);
      toast.success("Joining live room");
    } catch (error) {
      console.error("[StreamPostCardContent] Failed to join live room", error);
      toast.error(error instanceof Error ? error.message : "Failed to join live room");
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground/60">
        <Badge variant={isLive ? "destructive" : "outline"}>{isLive ? "Live" : "Ended"}</Badge>
        <Badge variant="outline" className="capitalize">
          {visibility.replace("-", " ")}
        </Badge>
        {promotedLabel && <span>Promoted {promotedLabel}</span>}
        {endedLabel && <span>Ended {endedLabel}</span>}
      </div>

      <div className="space-y-4 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] p-5 backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-foreground/60">
              {isEnded && hasRecording ? "Recorded session" : "Live room"}
            </p>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/60">
              {!isEnded && (
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {participantCount}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Radio className="h-3.5 w-3.5" />
                {isLive ? "Broadcasting" : isEnded && hasRecording ? "Recording available" : "Off-air"}
              </span>
            </div>
          </div>
          {summaryId && (
            <div className="flex items-center gap-2 rounded-full border border-[hsla(326,71%,62%,0.3)] bg-[hsla(326,71%,62%,0.12)] px-3 py-1 text-xs font-medium text-foreground/70">
              <Clock className="h-3.5 w-3.5" /> Summary ready
            </div>
          )}
        </div>

        {requiresInvite && !canJoin && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            <Lock className="h-3.5 w-3.5" /> Invite required — request access from the host.
          </div>
        )}

        {isEnded ? (
          <div className="space-y-3">
            {recordingUrl ? (
              /* Show actual video player when we have the recording blob */
              <div className="overflow-hidden rounded-lg bg-black">
                <video
                  ref={videoRef}
                  src={recordingUrl}
                  controls
                  playsInline
                  className="aspect-video w-full"
                  preload="metadata"
                />
              </div>
            ) : hasRecording ? (
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="text-sm text-foreground/70">
                  Recording is loading…
                </p>
                <Button type="button" variant="secondary" disabled className="gap-2">
                  <PlayCircle className="h-4 w-4" />
                  Loading replay…
                </Button>
              </div>
            ) : recordingProcessing ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <Badge
                    variant="secondary"
                    className="animate-pulse border-primary/30 bg-primary/10 text-primary"
                  >
                    Processing recording…
                  </Badge>
                </div>
                {transferProgress ? (
                  <div className="w-full max-w-xs space-y-1.5">
                    <div className="flex items-center justify-between text-[0.6rem] text-foreground/50">
                      <span className="truncate font-mono">{transferProgress.fileName}</span>
                      <span>{transferProgress.percent}%</span>
                    </div>
                    <Progress value={transferProgress.percent} className="h-1.5" />
                    <p className="text-[0.55rem] text-foreground/40">
                      {transferProgress.receivedChunks}/{transferProgress.totalChunks} chunks
                      {transferProgress.complete ? " — ready" : " — downloading"}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-foreground/50">
                    Recording is being saved in the background. Replay will appear here automatically.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <p className="text-sm font-medium text-foreground/70">
                  Meeting has ended
                </p>
                <p className="text-xs text-foreground/50">
                  No recording was saved for this session.
                </p>
              </div>
            )}
            {summaryId && (
              <p className="text-xs text-foreground/60">Auto-summary ID: {summaryId}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-foreground/70">
              {canJoin
                ? "Hop in to co-create the conversation in real time."
                : "Waiting for an invitation before you can join."}
            </p>
            <Button
              type="button"
              onClick={handleJoin}
              disabled={isJoining || (requiresInvite && !canJoin)}
              className="gap-2"
            >
              <Radio className="h-4 w-4" />
              {isJoining ? "Joining…" : "Join live room"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
