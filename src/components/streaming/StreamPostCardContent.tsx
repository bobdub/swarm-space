import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStreaming } from "@/hooks/useStreaming";
import { useAuth } from "@/hooks/useAuth";
import type { Post } from "@/types";
import { toast } from "sonner";
import { Lock, PlayCircle, Radio, Users, Clock } from "lucide-react";

interface StreamPostCardContentProps {
  post: Post;
}

export function StreamPostCardContent({ post }: StreamPostCardContentProps): JSX.Element {
  const stream = post.stream ?? null;
  const { roomsById, connect, joinRoom, refreshRoom } = useStreaming();
  const { user } = useAuth();
  const [isJoining, setIsJoining] = useState(false);
  const [hydrateAttempted, setHydrateAttempted] = useState(false);

  const room = stream ? roomsById[stream.roomId] : undefined;

  useEffect(() => {
    if (!stream) {
      return;
    }
    if (stream.broadcastState === "ended") {
      return;
    }
    if (room) {
      return;
    }
    if (hydrateAttempted) {
      return;
    }
    setHydrateAttempted(true);
    refreshRoom(stream.roomId).catch(() => {
      // Ignore errors; the UI will fall back to stored metadata
    });
  }, [stream, room, refreshRoom, hydrateAttempted]);

  const promotedLabel = useMemo(() => {
    if (!stream?.promotedAt) {
      return null;
    }
    try {
      return formatDistanceToNow(new Date(stream.promotedAt), { addSuffix: true });
    } catch {
      return null;
    }
  }, [stream?.promotedAt]);

  const endedLabel = useMemo(() => {
    if (!stream) {
      return null;
    }
    const endedAt = stream.endedAt ?? room?.endedAt;
    if (!endedAt) {
      return null;
    }
    try {
      return formatDistanceToNow(new Date(endedAt), { addSuffix: true });
    } catch {
      return null;
    }
  }, [stream, room?.endedAt]);

  if (!stream) {
    return (
      <div className="space-y-3">
        <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground/75">
          {post.content}
        </div>
      </div>
    );
  }

  const visibility = room?.visibility ?? stream.visibility;
  const requiresInvite = visibility === "invite-only";
  const participantCount = room?.participants.length ?? 0;
  const broadcastState = room?.state === "ended" ? "ended" : stream.broadcastState;
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
  const summaryId = stream.summaryId ?? room?.summary?.summaryId ?? null;
  const hasRecording = Boolean(stream.recordingId ?? room?.recording?.recordingId);
  const title = stream.title || post.content || "Live room";

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

  const handleReplay = () => {
    if (!hasRecording) {
      toast.info("Replay is still processing—check back soon");
      return;
    }
    toast.info("Replay playback will launch once the viewer is wired up");
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
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-foreground/60">Live room</p>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/60">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {participantCount}
              </span>
              <span className="flex items-center gap-1">
                <Radio className="h-3.5 w-3.5" />
                {isLive ? "Broadcasting" : "Off-air"}
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
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1 text-sm text-foreground/70">
              <p>{hasRecording ? "Replay is available once the manifest sync completes." : "Replay is processing—hang tight while we stitch the recording."}</p>
              {summaryId && <p className="text-xs text-foreground/60">Auto-summary ID: {summaryId}</p>}
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleReplay}
              disabled={!hasRecording}
              className="gap-2"
            >
              <PlayCircle className="h-4 w-4" />
              {hasRecording ? "Watch replay" : "Replay pending"}
            </Button>
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
