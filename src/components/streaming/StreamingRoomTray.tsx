import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useStreaming } from "@/hooks/useStreaming";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import { cn } from "@/lib/utils";
import { get, put } from "@/lib/store";
import type { Post } from "@/types";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  LogOut,
  Mic,
  MicOff,
  Radio,
  Users,
  VideoOff,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  live: "Live",
  ended: "Ended",
};

export function StreamingRoomTray(): JSX.Element | null {
  const {
    activeRoom,
    roomsById,
    leaveRoom,
    joinRoom,
    connect,
    sendModerationAction,
    promoteRoomToPost,
    toggleRecording,
  } = useStreaming();
  const { user } = useAuth();
  const { broadcastPost, announceContent } = useP2PContext();
  const [collapsed, setCollapsed] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [moderatingPeerId, setModeratingPeerId] = useState<string | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isTogglingRecording, setIsTogglingRecording] = useState(false);

  const otherRooms = useMemo(() => {
    const currentId = activeRoom?.id;
    return Object.values(roomsById).filter((room) => room.id !== currentId && room.state !== "ended");
  }, [activeRoom?.id, roomsById]);

  if (!activeRoom && otherRooms.length === 0) {
    return null;
  }

  const participants = activeRoom?.participants ?? [];
  const selfParticipant = participants.find((participant) => participant.userId === user?.id);
  const canModerate = Boolean(
    selfParticipant && (selfParticipant.role === "host" || selfParticipant.role === "cohost"),
  );
  const recordingStatus = activeRoom?.recording?.status ?? "off";
  const isRecordingActive = recordingStatus === "recording" || recordingStatus === "starting";

  const handleLeaveRoom = async () => {
    if (!activeRoom) return;
    setIsLeaving(true);
    try {
      await leaveRoom(activeRoom.id);
      toast.success("Left the live room");
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to leave room", error);
      toast.error(error instanceof Error ? error.message : "Failed to leave room");
    } finally {
      setIsLeaving(false);
    }
  };

  const handleToggleMute = async (peerId: string, muted: boolean) => {
    if (!activeRoom) return;
    setModeratingPeerId(peerId);
    try {
      await sendModerationAction(activeRoom.id, {
        type: muted ? "unmute" : "mute",
        peerId,
        scope: "audio",
      });
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to toggle mute", error);
      toast.error(error instanceof Error ? error.message : "Failed to update participant");
    } finally {
      setModeratingPeerId(null);
    }
  };

  const handleBanParticipant = async (peerId: string) => {
    if (!activeRoom) return;
    setModeratingPeerId(peerId);
    try {
      await sendModerationAction(activeRoom.id, {
        type: "ban",
        peerId,
        durationSeconds: 60 * 60,
      });
      toast.success("Participant removed");
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to remove participant", error);
      toast.error(error instanceof Error ? error.message : "Failed to remove participant");
    } finally {
      setModeratingPeerId(null);
    }
  };

  const handlePromote = async () => {
    if (!activeRoom) return;
    if (!user) {
      toast.error("You must be signed in to promote a room");
      return;
    }
    setIsPromoting(true);
    try {
      const response = await promoteRoomToPost(activeRoom.id);
      const nowIso = new Date().toISOString();
      const metadata = {
        roomId: activeRoom.id,
        title: activeRoom.title,
        context: activeRoom.context,
        projectId: activeRoom.projectId ?? null,
        visibility: activeRoom.visibility,
        broadcastState: "broadcast" as const,
        promotedAt: nowIso,
        recordingId: activeRoom.recording?.recordingId ?? null,
        summaryId: activeRoom.summary?.summaryId ?? null,
        endedAt: activeRoom.endedAt ?? activeRoom.broadcast?.updatedAt ?? null,
      };

      const existing = await get<Post>("posts", response.postId);
      const mergedPost: Post = existing
        ? {
            ...existing,
            type: "stream",
            projectId:
              existing.projectId ??
              (metadata.context === "project" ? metadata.projectId ?? null : null),
            content:
              existing.content && existing.content.trim().length > 0
                ? existing.content
                : metadata.title,
            stream: {
              promotedAt: existing.stream?.promotedAt ?? metadata.promotedAt,
              ...metadata,
              recordingId: metadata.recordingId ?? existing.stream?.recordingId ?? null,
              summaryId: metadata.summaryId ?? existing.stream?.summaryId ?? null,
              endedAt: existing.stream?.endedAt ?? metadata.endedAt ?? null,
            },
          }
        : {
            id: response.postId,
            author: user.id,
            authorName: user.displayName || user.username,
            authorAvatarRef: user.profile?.avatarRef,
            authorBannerRef: user.profile?.bannerRef,
            authorBadgeSnapshots: undefined,
            projectId: metadata.context === "project" ? metadata.projectId ?? null : null,
            type: "stream",
            content: metadata.title,
            manifestIds: [],
            createdAt: nowIso,
            nsfw: false,
            likes: 0,
            reactions: [],
            comments: [],
            stream: metadata,
          };

      if (!mergedPost.createdAt) {
        mergedPost.createdAt = nowIso;
      }
      if (!mergedPost.reactions) {
        mergedPost.reactions = [];
      }
      if (!mergedPost.comments) {
        mergedPost.comments = [];
      }

      mergedPost.stream = {
        ...metadata,
        ...mergedPost.stream,
        promotedAt: mergedPost.stream?.promotedAt ?? metadata.promotedAt,
        recordingId: metadata.recordingId ?? mergedPost.stream?.recordingId ?? null,
        summaryId: metadata.summaryId ?? mergedPost.stream?.summaryId ?? null,
        endedAt: mergedPost.stream?.endedAt ?? metadata.endedAt ?? null,
      };

      await put("posts", mergedPost);
      announceContent(mergedPost.id);
      broadcastPost(mergedPost);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
      }
      toast.success("Live room promoted to feed");
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to promote room", error);
      toast.error(error instanceof Error ? error.message : "Failed to promote room");
    } finally {
      setIsPromoting(false);
    }
  };

  const handleRecordingToggle = async () => {
    if (!activeRoom) return;
    setIsTogglingRecording(true);
    try {
      await toggleRecording(activeRoom.id, !isRecordingActive);
      toast.success(!isRecordingActive ? "Recording started" : "Recording stopped");
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to toggle recording", error);
      toast.error(error instanceof Error ? error.message : "Failed to toggle recording");
    } finally {
      setIsTogglingRecording(false);
    }
  };

  const handleJoinRoom = async (roomId: string) => {
    setJoiningRoomId(roomId);
    try {
      await connect();
      await joinRoom(roomId);
      toast.success("Joined live room");
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to join room", error);
      toast.error(error instanceof Error ? error.message : "Failed to join live room");
    } finally {
      setJoiningRoomId(null);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-full max-w-sm">
      <Card className="border border-[hsla(174,59%,56%,0.35)] bg-[hsla(245,70%,8%,0.85)] shadow-xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/60">
              Live Rooms
            </p>
            {activeRoom ? (
              <div className="mt-1 space-y-1">
                <p className="text-sm font-medium text-foreground">{activeRoom.title}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
                  <Badge variant="secondary" className="capitalize">
                    {STATUS_LABELS[activeRoom.state] ?? activeRoom.state}
                  </Badge>
                  <Badge variant="outline" className="capitalize">
                    {activeRoom.visibility.replace("-", " ")}
                  </Badge>
                  <div className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    <span>{participants.length}</span>
                  </div>
                  {isRecordingActive && (
                    <Badge variant="destructive">Recording</Badge>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-1 text-sm text-foreground/70">Select a room to join</p>
            )}
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand live rooms" : "Collapse live rooms"}
            className="text-foreground/70 hover:text-foreground"
          >
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {!collapsed && (
          <div className="space-y-4 px-4 py-3">
            {activeRoom ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {canModerate && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={handlePromote}
                      disabled={isPromoting}
                      className="gap-2"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Promote to feed
                    </Button>
                  )}
                  {canModerate && (
                    <Button
                      type="button"
                      size="sm"
                      variant={isRecordingActive ? "destructive" : "outline"}
                      onClick={handleRecordingToggle}
                      disabled={isTogglingRecording}
                      className="gap-2"
                    >
                      <Radio className="h-3.5 w-3.5" />
                      {isRecordingActive ? "Stop recording" : "Start recording"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleLeaveRoom}
                    disabled={isLeaving}
                    className="gap-2 text-foreground/80"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Leave room
                  </Button>
                </div>

                <ScrollArea className="max-h-60 rounded-md border border-white/10">
                  <div className="divide-y divide-white/5">
                    {participants.map((participant) => {
                      const isSelf = participant.userId === user?.id;
                      const audioMuted = participant.audioMuted;
                      const videoMuted = participant.videoMuted;
                      return (
                        <div
                          key={participant.peerId}
                          className={cn(
                            "flex items-center justify-between gap-3 px-3 py-2 text-sm",
                            isSelf ? "bg-white/5" : undefined,
                          )}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{participant.handle}</span>
                              <Badge variant="outline" className="capitalize">
                                {participant.role}
                              </Badge>
                              {isSelf && (
                                <Badge variant="secondary">You</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-foreground/60">
                              <span className="flex items-center gap-1">
                                {audioMuted ? (
                                  <MicOff className="h-3 w-3" />
                                ) : (
                                  <Mic className="h-3 w-3" />
                                )}
                                {audioMuted ? "Muted" : "Live"}
                              </span>
                              <span className="flex items-center gap-1">
                                <VideoOff className="h-3 w-3" />
                                {videoMuted ? "Video off" : "Video on"}
                              </span>
                            </div>
                          </div>
                          {canModerate && !isSelf && (
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => handleToggleMute(participant.peerId, audioMuted)}
                                disabled={moderatingPeerId === participant.peerId}
                                aria-label={audioMuted ? "Unmute participant" : "Mute participant"}
                              >
                                {audioMuted ? (
                                  <Mic className="h-4 w-4" />
                                ) : (
                                  <MicOff className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => handleBanParticipant(participant.peerId)}
                                disabled={moderatingPeerId === participant.peerId}
                                aria-label="Remove participant"
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {participants.length === 0 && (
                      <div className="px-3 py-6 text-center text-sm text-foreground/60">
                        Waiting for participants…
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-foreground/70">
                <p>No active room selected. Join one below to get started.</p>
              </div>
            )}

            {otherRooms.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/60">
                  Available rooms
                </p>
                <div className="space-y-2">
                  {otherRooms.map((room) => {
                    const participantCount = room.participants.length;
                    return (
                      <div
                        key={room.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">{room.title}</p>
                          <div className="flex items-center gap-2 text-xs text-foreground/60">
                            <Badge variant="outline" className="capitalize">
                              {room.visibility.replace("-", " ")}
                            </Badge>
                            <span className="flex items-center gap-1">
                              <Radio className="h-3.5 w-3.5" />
                              {STATUS_LABELS[room.state] ?? room.state}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              {participantCount}
                            </span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleJoinRoom(room.id)}
                          disabled={joiningRoomId === room.id}
                        >
                          {joiningRoomId === room.id ? "Joining…" : "Join"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeRoom && !canModerate && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <ShieldAlert className="h-3.5 w-3.5" />
                Host controls are limited to room moderators.
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
