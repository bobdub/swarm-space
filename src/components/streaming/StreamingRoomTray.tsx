import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStreaming } from "@/hooks/useStreaming";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import { cn } from "@/lib/utils";
import { get, getAll, put } from "@/lib/store";
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
  UserPlus,
  Check,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { LiveStreamControls } from "./LiveStreamControls";
import { InviteUsersModal } from "./InviteUsersModal";
import type { RecordingResult } from "@/hooks/useRecording";
import { saveRecordingBlob } from "@/lib/streaming/recordingStore";
import { broadcastRoomEnded as broadcastRoomEndedToMesh } from "@/lib/streaming/streamSync.standalone";
import {
  getRoomChatMessages,
  onRoomChatMessage,
  sendRoomChatMessage,
  type RoomChatMessage,
} from "@/lib/streaming/webrtcSignalingBridge.standalone";

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  live: "Live",
  ended: "Ended",
};

export function StreamingRoomTray(): JSX.Element | null {
  const {
    activeRoom,
    leaveRoom,
    sendModerationAction,
    promoteRoomToPost,
  } = useStreaming();
  const { user } = useAuth();
  const { broadcastPost, announceContent } = useP2PContext();
  const [collapsed, setCollapsed] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [moderatingPeerId, setModeratingPeerId] = useState<string | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isPromoted, setIsPromoted] = useState(false);
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"stream" | "participants" | "chat">("stream");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
  const [shouldAutoScrollChat, setShouldAutoScrollChat] = useState(true);
  const chatScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const endingRoomRef = useRef<string | null>(null);

  useEffect(() => {
    setIsRecordingActive(false);
    // Initialize promotion state from room metadata
    setIsPromoted(Boolean(activeRoom?.broadcast?.postId));
  }, [activeRoom?.id, activeRoom?.broadcast?.postId]);

  useEffect(() => {
    if (!activeRoom) {
      setChatMessages([]);
      return;
    }
    setChatMessages(getRoomChatMessages(activeRoom.id));
    const unsubscribe = onRoomChatMessage((message) => {
      if (message.roomId !== activeRoom.id) {
        return;
      }
      setChatMessages((prev) => {
        if (prev.some((entry) => entry.id === message.id)) {
          return prev;
        }
        return [...prev, message].sort((a, b) => a.ts - b.ts);
      });
    });
    return () => {
      unsubscribe();
    };
  }, [activeRoom?.id]);

  useEffect(() => {
    if (!chatScrollAreaRef.current) return;
    const viewport = chatScrollAreaRef.current.querySelector<HTMLDivElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;
    chatViewportRef.current = viewport;

    const handleScroll = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setShouldAutoScrollChat(distanceFromBottom < 48);
    };

    viewport.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [activeRoom?.id, activeTab]);

  useEffect(() => {
    if (!shouldAutoScrollChat) return;
    const viewport = chatViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [chatMessages, shouldAutoScrollChat]);

  const shouldHide = !activeRoom;

  const participants = activeRoom?.participants ?? [];
  const selfParticipant = participants.find((participant) => participant.userId === user?.id);
  const canModerate = Boolean(
    selfParticipant && (selfParticipant.role === "host" || selfParticipant.role === "cohost"),
  );

  const persistRecordingBlobForRoom = useCallback(
    async (roomId: string, recording?: RecordingResult): Promise<string | null> => {
      if (!recording || recording.blob.size <= 0) {
        return null;
      }

      const recordingId = `rec-${roomId}-${Date.now()}`;
      try {
        await saveRecordingBlob(recordingId, recording.blob);
        console.log(
          "[StreamingRoomTray] Recording saved:",
          recordingId,
          recording.blob.size,
          "bytes",
        );

        // Seed the recording blob into the swarm mesh so it appears in Content Distribution
        try {
          const file = new File([recording.blob], `${recordingId}.webm`, { type: recording.blob.type || 'video/webm' });
          announceContent(recordingId);
          // Dispatch event so torrent swarm can pick it up and seed chunks
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('torrent-seed-file', {
              detail: { fileId: recordingId, file, fileName: `${recordingId}.webm` },
            }));
          }
          console.log('[StreamingRoomTray] Recording announced to swarm mesh:', recordingId);
        } catch (seedError) {
          console.warn('[StreamingRoomTray] Failed to seed recording to mesh:', seedError);
        }

        return recordingId;
      } catch (error) {
        console.error("[StreamingRoomTray] Failed to save recording:", error);
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

      if (streamPosts.length === 0) {
        return false;
      }

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
        if (attached) {
          return true;
        }
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 1_000);
        });
      }
      return false;
    },
    [attachRecordingToStreamPosts],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleRecordingFinalized = (event: Event) => {
      const detail = (
        event as CustomEvent<{ roomId?: string; recording?: RecordingResult }>
      ).detail;
      if (!detail?.roomId || !detail.recording?.blob.size) {
        return;
      }

      void (async () => {
        const recordingId = await persistRecordingBlobForRoom(detail.roomId!, detail.recording);
        if (!recordingId) {
          return;
        }

        try {
          const attached = await attachRecordingWithRetry(detail.roomId!, recordingId);
          if (attached) {
            toast.success("Replay attached to feed post");
          } else {
            toast.warning("Recording saved, still syncing replay metadata");
          }
        } catch (error) {
          console.error("[StreamingRoomTray] Failed to attach background recording:", error);
        }
      })();
    };

    window.addEventListener("stream-recording-finalized", handleRecordingFinalized);
    return () => {
      window.removeEventListener("stream-recording-finalized", handleRecordingFinalized);
    };
  }, [attachRecordingWithRetry, persistRecordingBlobForRoom]);

  const handleLeaveRoom = async () => {
    if (!activeRoom) return;
    setIsLeaving(true);
    try {
      // If host, trigger full end-stream flow (saves recording, marks post ended)
      if (canModerate) {
        window.dispatchEvent(new CustomEvent("host-end-stream"));
        return;
      }
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

  const handleSendChatMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeRoom || !chatInput.trim()) return;
    sendRoomChatMessage(activeRoom.id, chatInput, user?.id, user?.username ?? "Guest");
    setChatInput("");
    setShouldAutoScrollChat(true);
  };

  const handleToggleVideo = async (peerId: string, muted: boolean) => {
    if (!activeRoom) return;
    setModeratingPeerId(peerId);
    try {
      await sendModerationAction(activeRoom.id, {
        type: muted ? "unmute" : "mute",
        peerId,
        scope: "video",
      });
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to toggle video", error);
      toast.error(error instanceof Error ? error.message : "Failed to update participant");
    } finally {
      setModeratingPeerId(null);
    }
  };

  const handleStreamStart = () => {
    if (!activeRoom || !user) return;
    
    // Notify potential viewers
    const notification = {
      roomId: activeRoom.id,
      roomTitle: activeRoom.title,
      hostName: user.displayName || user.username,
    };
    
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("stream-starting", {
        detail: notification,
      }));
    }
  };

  const handleStreamPause = () => {
    console.log("[StreamingRoomTray] Stream paused");
    toast.info("Broadcast paused - room remains active");
  };

  const handleStreamResume = () => {
    console.log("[StreamingRoomTray] Stream resumed");
    toast.success("Broadcast resumed");
  };

  const handleStreamEnd = useCallback(async (recording?: RecordingResult) => {
    if (!activeRoom) return;
    if (endingRoomRef.current === activeRoom.id) return;

    const roomSnapshot = activeRoom;
    const roomId = roomSnapshot.id;
    const endedAt = new Date().toISOString();
    endingRoomRef.current = roomId;

    const recordingId = await persistRecordingBlobForRoom(roomId, recording);

    // Always mark every post for this room as ended.
    try {
      const postEntries = await getAll<Post>("posts");
      const streamPosts = postEntries.filter(
        (p) => p.stream?.roomId === roomId,
      );

      for (const post of streamPosts) {
        if (!post.stream) continue;
        const updatedPost: Post = {
          ...post,
          type: "stream",
          stream: {
            roomId,
            title: post.stream.title ?? roomSnapshot.title,
            context: post.stream.context ?? roomSnapshot.context,
            projectId: post.stream.projectId ?? roomSnapshot.projectId ?? null,
            visibility: post.stream.visibility ?? roomSnapshot.visibility,
            broadcastState: "ended",
            promotedAt:
              post.stream.promotedAt ?? roomSnapshot.broadcast?.promotedAt ?? endedAt,
            recordingId: recordingId ?? post.stream.recordingId ?? null,
            summaryId:
              post.stream.summaryId ?? roomSnapshot.summary?.summaryId ?? null,
            endedAt,
          },
        };

        await put("posts", updatedPost);
        announceContent(updatedPost.id);
        broadcastPost(updatedPost);
      }

      // Fallback: if we have a promoted postId but it wasn't in local query yet.
      const fallbackPostId = roomSnapshot.broadcast?.postId;
      if (streamPosts.length === 0 && fallbackPostId) {
        const fallbackPost = await get<Post>("posts", fallbackPostId);
        if (fallbackPost?.stream) {
          const updatedFallback: Post = {
            ...fallbackPost,
            type: "stream",
            stream: {
              roomId,
              title: fallbackPost.stream.title ?? roomSnapshot.title,
              context: fallbackPost.stream.context ?? roomSnapshot.context,
              projectId: fallbackPost.stream.projectId ?? roomSnapshot.projectId ?? null,
              visibility: fallbackPost.stream.visibility ?? roomSnapshot.visibility,
              broadcastState: "ended",
              promotedAt:
                fallbackPost.stream.promotedAt ?? roomSnapshot.broadcast?.promotedAt ?? endedAt,
              recordingId: recordingId ?? fallbackPost.stream.recordingId ?? null,
              summaryId:
                fallbackPost.stream.summaryId ?? roomSnapshot.summary?.summaryId ?? null,
              endedAt,
            },
          };

          await put("posts", updatedFallback);
          announceContent(updatedFallback.id);
          broadcastPost(updatedFallback);
        }
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
      }
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to update post:", error);
    }

    // Force room closure state across local + mesh regardless of participant drift.
    broadcastRoomEndedToMesh(roomId);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("stream-room-ended", { detail: roomId }));
    }

    if (recordingId) {
      toast.success("Recording saved to this session");
    }

    try {
      await leaveRoom(roomId);
      toast.success("Stream ended and room closed");
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to end stream:", error);
      toast.error("Failed to end stream");
    } finally {
      setIsLeaving(false);
      endingRoomRef.current = null;
    }
  }, [activeRoom, leaveRoom, announceContent, broadcastPost, persistRecordingBlobForRoom]);

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
        broadcastState: (activeRoom.broadcast?.state ?? "backstage") as "backstage" | "broadcast" | "ended",
        promotedAt: nowIso,
        recordingId: activeRoom.recording?.recordingId ?? null,
        summaryId: activeRoom.summary?.summaryId ?? null,
        endedAt: activeRoom.broadcast?.state === "ended"
          ? (activeRoom.endedAt ?? activeRoom.broadcast?.updatedAt ?? null)
          : null,
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
      setIsPromoted(true);
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to promote room", error);
      toast.error(error instanceof Error ? error.message : "Failed to promote room");
    } finally {
      setIsPromoting(false);
    }
  };

  const handleRecordingToggle = () => {
    if (!activeRoom) return;
    window.dispatchEvent(
      new CustomEvent("stream-record-toggle", {
        detail: { roomId: activeRoom.id },
      }),
    );
  };

  if (shouldHide) return null;

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
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant={isPromoted ? "outline" : "secondary"}
                        onClick={handlePromote}
                        disabled={isPromoting || isPromoted}
                        className={cn("gap-2", isPromoted && "opacity-70 cursor-default")}
                      >
                        {isPromoted ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        {isPromoted ? "PROMOTED" : "Promote to feed"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={isRecordingActive ? "destructive" : "outline"}
                        onClick={handleRecordingToggle}
                        
                        className="gap-2"
                      >
                        <Radio className="h-3.5 w-3.5" />
                        {isRecordingActive ? "Stop" : "Record"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setIsInviteModalOpen(true)}
                        className="gap-2"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Invite
                      </Button>
                    </>
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
                    Leave
                  </Button>
                </div>

                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="stream">
                      <Video className="mr-2 h-3.5 w-3.5" />
                      Stream
                    </TabsTrigger>
                    <TabsTrigger value="participants">
                      <Users className="mr-2 h-3.5 w-3.5" />
                      Participants ({participants.length})
                    </TabsTrigger>
                    <TabsTrigger value="chat">
                      <Radio className="mr-2 h-3.5 w-3.5" />
                      Chat ({chatMessages.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="stream" className="mt-3" forceMount>
                  <LiveStreamControls
                    roomId={activeRoom.id}
                    isHost={canModerate}
                    onStreamStart={handleStreamStart}
                    onStreamPause={handleStreamPause}
                    onStreamResume={handleStreamResume}
                    onStreamEnd={handleStreamEnd}
                    onRecordingStateChange={setIsRecordingActive}
                  />
                  </TabsContent>

                  <TabsContent value="participants" className="mt-3">
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
                                  <span className="font-medium text-foreground">
                                    {participant.handle}
                                  </span>
                                  <Badge variant="outline" className="capitalize">
                                    {participant.role}
                                  </Badge>
                                  {isSelf && <Badge variant="secondary">You</Badge>}
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
                                    {videoMuted ? (
                                      <VideoOff className="h-3 w-3" />
                                    ) : (
                                      <Video className="h-3 w-3" />
                                    )}
                                    {videoMuted ? "Off" : "On"}
                                  </span>
                                </div>
                              </div>
                              {canModerate && !isSelf && (
                                <div className="flex items-center gap-1">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => handleToggleMute(participant.peerId, audioMuted)}
                                    disabled={moderatingPeerId === participant.peerId}
                                    aria-label={audioMuted ? "Unmute" : "Mute"}
                                    className="h-8 w-8"
                                  >
                                    {audioMuted ? (
                                      <Mic className="h-3.5 w-3.5" />
                                    ) : (
                                      <MicOff className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => handleToggleVideo(participant.peerId, videoMuted)}
                                    disabled={moderatingPeerId === participant.peerId}
                                    aria-label={videoMuted ? "Enable video" : "Disable video"}
                                    className="h-8 w-8"
                                  >
                                    {videoMuted ? (
                                      <Video className="h-3.5 w-3.5" />
                                    ) : (
                                      <VideoOff className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => handleBanParticipant(participant.peerId)}
                                    disabled={moderatingPeerId === participant.peerId}
                                    aria-label="Remove"
                                    className="h-8 w-8"
                                  >
                                    <Ban className="h-3.5 w-3.5" />
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
                  </TabsContent>

                  <TabsContent value="chat" className="mt-3 space-y-2">
                    <div ref={chatScrollAreaRef}>
                      <ScrollArea className="h-60 rounded-md border border-white/10">
                        <div className="space-y-2 p-3">
                          {chatMessages.map((message) => {
                            const isSelf = message.senderUserId === user?.id;
                            const senderLabel = isSelf
                              ? "You"
                              : message.senderUsername ?? message.senderUserId ?? message.senderPeerId;
                            return (
                              <div
                                key={message.id}
                                className={cn(
                                  "rounded-md border border-white/10 px-2 py-1.5 text-xs",
                                  isSelf ? "bg-white/10" : "bg-black/20",
                                )}
                              >
                                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-foreground/60">
                                  <span className="truncate font-medium">{senderLabel}</span>
                                  <span>{new Date(message.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                </div>
                                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{message.text}</p>
                              </div>
                            );
                          })}
                          {chatMessages.length === 0 && (
                            <div className="py-8 text-center text-sm text-foreground/60">
                              No messages yet — start the conversation.
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </div>

                    <form onSubmit={handleSendChatMessage} className="flex gap-2">
                      <input
                        value={chatInput}
                        onChange={(event) => setChatInput(event.target.value)}
                        placeholder="Type a message…"
                        className="h-9 flex-1 rounded-md border border-white/15 bg-black/20 px-3 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-white/30"
                        maxLength={500}
                      />
                      <Button type="submit" size="sm" disabled={!chatInput.trim()}>
                        Send
                      </Button>
                    </form>
                  </TabsContent>
                </Tabs>
              </div>
            ) : null}

            {activeRoom && !canModerate && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <ShieldAlert className="h-3.5 w-3.5" />
                Host controls are limited to room moderators.
              </div>
            )}
          </div>
        )}
      </Card>

      {activeRoom && (
        <InviteUsersModal
          isOpen={isInviteModalOpen}
          onClose={() => setIsInviteModalOpen(false)}
          roomId={activeRoom.id}
          roomTitle={activeRoom.title}
        />
      )}
    </div>
  );
}
