import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useStreaming } from "@/hooks/useStreaming";
import { useAuth } from "@/hooks/useAuth";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useP2PContext } from "@/contexts/P2PContext";
import { cn } from "@/lib/utils";
import { get, getAll, put } from "@/lib/store";
import type { Post } from "@/types";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  GripHorizontal,
  LogOut,
  Maximize2,
  MessageSquareReply,
  Mic,
  MicOff,
  Minimize2,
  Radio,
  Users,
  VideoOff,
  ShieldAlert,
  Upload,
  UserPlus,
  Check,
  Video,
  Volume2,
  X,
  CameraOff,
  MonitorUp,
} from "lucide-react";
import { toast } from "sonner";
import { LiveStreamControls } from "./LiveStreamControls";
import { InviteUsersModal } from "./InviteUsersModal";
import { PersistentAudioLayer } from "./PersistentAudioLayer";
import { Avatar } from "@/components/Avatar";
import type { RecordingResult } from "@/hooks/useRecording";
import { saveRecordingBlob } from "@/lib/streaming/recordingStore";
import {
  broadcastRoom as broadcastRoomToMesh,
  broadcastRoomEnded as broadcastRoomEndedToMesh,
} from "@/lib/streaming/streamSync.standalone";
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

const LONG_MESSAGE_THRESHOLD = 2400; // ~400 words
const POSITION_KEY = "swarm-tray-position";

type DockPosition = "docked-left" | "docked-right" | "docked-bottom";
type TrayPosition = { x: number; y: number } | DockPosition;

function isDockedPosition(pos: TrayPosition): pos is DockPosition {
  return typeof pos === "string";
}

export function StreamingRoomTray(): JSX.Element | null {
  const {
    activeRoom,
    leaveRoom,
    sendModerationAction,
    promoteRoomToPost,
  } = useStreaming();
  const { user } = useAuth();
  const { participants: webrtcParticipants } = useWebRTC();
  const { broadcastPost, announceContent } = useP2PContext();
  const [collapsed, setCollapsed] = useState(false);
  
  const [fullscreen, setFullscreen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [moderatingPeerId, setModeratingPeerId] = useState<string | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isPromoted, setIsPromoted] = useState(false);
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"participants" | "chat">("participants");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
  const [shouldAutoScrollChat, setShouldAutoScrollChat] = useState(true);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<{ id: string; username: string; preview: string } | null>(null);
  const [pinnedPeerId, setPinnedPeerId] = useState<string | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);

  // Dragging state
  const [trayPosition, setTrayPosition] = useState<TrayPosition>(() => {
    try {
      const saved = sessionStorage.getItem(POSITION_KEY);
      return saved ? JSON.parse(saved) : "docked-bottom";
    } catch {
      return "docked-bottom";
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const trayRef = useRef<HTMLDivElement>(null);

  const chatScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const endingRoomRef = useRef<string | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── Active speaker detection (shared AudioContext) ──────────────
  const sharedAudioCtxRef = useRef<AudioContext | null>(null);
  const speakerAnalysersRef = useRef<Map<string, { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; streamId: string }>>(new Map());
  const speakerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (speakerIntervalRef.current) clearInterval(speakerIntervalRef.current);
      speakerAnalysersRef.current.clear();
      if (sharedAudioCtxRef.current) {
        sharedAudioCtxRef.current.close().catch(() => {});
        sharedAudioCtxRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!webrtcParticipants.length) {
      if (speakerIntervalRef.current) {
        clearInterval(speakerIntervalRef.current);
        speakerIntervalRef.current = null;
      }
      setActiveSpeaker(null);
      return;
    }

    // Lazily create a single shared AudioContext
    if (!sharedAudioCtxRef.current || sharedAudioCtxRef.current.state === "closed") {
      try {
        sharedAudioCtxRef.current = new AudioContext();
      } catch {
        return;
      }
    }
    const ctx = sharedAudioCtxRef.current;

    // Reconcile analysers: add new, remove stale
    const currentPeerIds = new Set<string>();
    for (const p of webrtcParticipants) {
      if (!p.stream) continue;
      currentPeerIds.add(p.peerId);
      const existing = speakerAnalysersRef.current.get(p.peerId);
      // Only recreate if stream changed
      if (existing && existing.streamId === p.stream.id) continue;
      // Disconnect old source if stream changed
      if (existing) {
        try { existing.source.disconnect(); } catch { /* ok */ }
      }
      try {
        const src = ctx.createMediaStreamSource(p.stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        speakerAnalysersRef.current.set(p.peerId, { source: src, analyser, streamId: p.stream.id });
      } catch { /* ignore */ }
    }
    // Remove analysers for peers no longer present
    for (const [peerId, entry] of speakerAnalysersRef.current) {
      if (!currentPeerIds.has(peerId)) {
        try { entry.source.disconnect(); } catch { /* ok */ }
        speakerAnalysersRef.current.delete(peerId);
      }
    }

    // Start polling if not already running
    if (!speakerIntervalRef.current) {
      const data = new Uint8Array(128);
      speakerIntervalRef.current = setInterval(() => {
        let maxRms = 0;
        let loudest: string | null = null;
        for (const [peerId, { analyser }] of speakerAnalysersRef.current) {
          analyser.getByteFrequencyData(data);
          const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length) / 255;
          if (rms > maxRms && rms > 0.02) {
            maxRms = rms;
            loudest = peerId;
          }
        }
        setActiveSpeaker(loudest);
      }, 500); // 500ms cap to reduce CPU
    }
  }, [webrtcParticipants]);

  // ── Dragging handlers ─────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.PointerEvent) => {
    if (fullscreen) return;
    const rect = trayRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: rect.left,
      startY: rect.top,
    };
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [fullscreen]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setTrayPosition({
      x: dragStartRef.current.startX + dx,
      y: dragStartRef.current.startY + dy,
    });
  }, [isDragging]);

  const handleDragEnd = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    // Snap zones
    const x = e.clientX;
    const y = e.clientY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let newPos: TrayPosition;
    if (x < 80) {
      newPos = "docked-left";
    } else if (x > vw - 80) {
      newPos = "docked-right";
    } else if (y > vh - 80) {
      newPos = "docked-bottom";
    } else {
      newPos = trayPosition;
    }

    setTrayPosition(newPos);
    try {
      sessionStorage.setItem(POSITION_KEY, JSON.stringify(newPos));
    } catch { /* ignore */ }
  }, [isDragging, trayPosition]);

  // Cross-tab sync via BroadcastChannel
  useEffect(() => {
    try {
      const channel = new BroadcastChannel("swarm-live-chat-tray");
      broadcastChannelRef.current = channel;

      channel.onmessage = (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "chat-message" && msg.roomId === activeRoom?.id) {
          setChatMessages((prev) => {
            if (prev.some((m) => m.id === msg.message.id)) return prev;
            return [...prev, msg.message].sort((a, b) => a.ts - b.ts);
          });
        }
        if (msg.type === "fullscreen-change") {
          setFullscreen(msg.fullscreen);
        }
      };

      if (activeRoom) {
        channel.postMessage({ type: "tab-active", roomId: activeRoom.id });
      }

      return () => {
        channel.close();
        broadcastChannelRef.current = null;
      };
    } catch {
      return;
    }
  }, [activeRoom?.id]);

  useEffect(() => {
    setIsRecordingActive(false);
    setIsPromoted(Boolean(activeRoom?.broadcast?.postId));
  }, [activeRoom?.id, activeRoom?.broadcast?.postId]);

  useEffect(() => {
    if (!activeRoom) {
      setChatMessages([]);
      return;
    }
    setChatMessages(getRoomChatMessages(activeRoom.id));
    const unsubscribe = onRoomChatMessage((message) => {
      if (message.roomId !== activeRoom.id) return;
      setChatMessages((prev) => {
        if (prev.some((entry) => entry.id === message.id)) return prev;
        return [...prev, message].sort((a, b) => a.ts - b.ts);
      });
    });
    return () => { unsubscribe(); };
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
    return () => { viewport.removeEventListener("scroll", handleScroll); };
  }, [activeRoom?.id, activeTab]);

  useEffect(() => {
    if (!shouldAutoScrollChat) return;
    const viewport = chatViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [chatMessages, shouldAutoScrollChat]);

  // ESC to exit fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen]);

  const shouldHide = !activeRoom;

  const participants = activeRoom?.participants ?? [];
  const selfParticipant = participants.find((p) => p.userId === user?.id);
  const canModerate = Boolean(
    selfParticipant && (selfParticipant.role === "host" || selfParticipant.role === "cohost"),
  );

  // ── Recording & stream end helpers (unchanged logic) ──────────────
  const persistRecordingBlobForRoom = useCallback(
    async (roomId: string, recording?: RecordingResult): Promise<string | null> => {
      if (!recording || recording.blob.size <= 0) return null;
      const recordingId = `rec-${roomId}-${Date.now()}`;
      try {
        await saveRecordingBlob(recordingId, recording.blob);
        console.log("[StreamingRoomTray] Recording saved:", recordingId, recording.blob.size, "bytes");
        try {
          const file = new File([recording.blob], `${recordingId}.webm`, { type: recording.blob.type || "video/webm" });
          announceContent(recordingId);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("torrent-seed-file", {
              detail: { fileId: recordingId, file, fileName: `${recordingId}.webm` },
            }));
          }
        } catch (seedError) {
          console.warn("[StreamingRoomTray] Failed to seed recording to mesh:", seedError);
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
      if (streamPosts.length === 0) return false;
      const endedAt = new Date().toISOString();
      let updatedAny = false;
      for (const post of streamPosts) {
        if (!post.stream) continue;
        if (post.stream.recordingId === recordingId) continue;
        const updatedPost: Post = {
          ...post,
          type: "stream",
          stream: { ...post.stream, broadcastState: "ended", recordingId, endedAt: post.stream.endedAt ?? endedAt },
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
        await new Promise<void>((resolve) => { window.setTimeout(resolve, 1_000); });
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
          console.error("[StreamingRoomTray] Failed to attach background recording:", error);
        }
      })();
    };
    window.addEventListener("stream-recording-finalized", handleRecordingFinalized);
    return () => { window.removeEventListener("stream-recording-finalized", handleRecordingFinalized); };
  }, [attachRecordingWithRetry, persistRecordingBlobForRoom]);

  const handleLeaveRoom = async () => {
    if (!activeRoom) return;
    setIsLeaving(true);
    try {
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
      await sendModerationAction(activeRoom.id, { type: muted ? "unmute" : "mute", peerId, scope: "audio" });
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
      await sendModerationAction(activeRoom.id, { type: "ban", peerId, durationSeconds: 60 * 60 });
      toast.success("Participant removed");
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to remove participant", error);
      toast.error(error instanceof Error ? error.message : "Failed to remove participant");
    } finally {
      setModeratingPeerId(null);
    }
  };

  const doSendChat = useCallback(() => {
    if (!activeRoom || !chatInput.trim()) return;
    sendRoomChatMessage(
      activeRoom.id,
      chatInput,
      user?.id,
      user?.username ?? "Guest",
      user?.profile?.avatarRef,
      replyTo ?? undefined,
    );
    setChatInput("");
    setReplyTo(null);
    setShouldAutoScrollChat(true);
  }, [activeRoom, chatInput, user, replyTo]);

  const handleSendChatMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    doSendChat();
  };

  };

  const handleToggleFullscreen = () => {
    setFullscreen((prev) => {
      const next = !prev;
      broadcastChannelRef.current?.postMessage({ type: "fullscreen-change", fullscreen: next });
      return next;
    });
  };

  const handleToggleVideo = async (peerId: string, muted: boolean) => {
    if (!activeRoom) return;
    setModeratingPeerId(peerId);
    try {
      await sendModerationAction(activeRoom.id, { type: muted ? "unmute" : "mute", peerId, scope: "video" });
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to toggle video", error);
      toast.error(error instanceof Error ? error.message : "Failed to update participant");
    } finally {
      setModeratingPeerId(null);
    }
  };

  const handleStreamStart = () => {
    if (!activeRoom || !user) return;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("stream-starting", {
        detail: { roomId: activeRoom.id, roomTitle: activeRoom.title, hostName: user.displayName || user.username },
      }));
    }
  };

  const handleStreamPause = () => { toast.info("Broadcast paused - room remains active"); };
  const handleStreamResume = () => { toast.success("Broadcast resumed"); };

  const convertChatToComments = useCallback(
    async (roomId: string, postId: string): Promise<number> => {
      const messages = getRoomChatMessages(roomId);
      if (messages.length === 0) return 0;
      const post = await get<Post>("posts", postId);
      if (!post) return 0;
      const existingCommentIds = new Set((post.comments ?? []).map((c) => c.id));
      const newComments: import("@/types").Comment[] = [];
      for (const msg of messages) {
        const commentId = `stream-chat-${msg.id}`;
        if (existingCommentIds.has(commentId)) continue;
        newComments.push({
          id: commentId, postId, author: msg.senderUserId ?? msg.senderPeerId,
          authorName: msg.senderUsername, authorAvatarRef: msg.senderAvatarRef,
          text: msg.text, createdAt: new Date(msg.ts).toISOString(),
        });
      }
      if (newComments.length === 0) return 0;
      const updatedPost: Post = { ...post, comments: [...(post.comments ?? []), ...newComments], commentCount: (post.comments?.length ?? 0) + newComments.length };
      await put("posts", updatedPost);
      announceContent(updatedPost.id);
      broadcastPost(updatedPost);
      return newComments.length;
    },
    [announceContent, broadcastPost],
  );

  const wrapChatIntoCoin = useCallback(
    async (roomId: string, postId: string, roomTitle: string) => {
      const messages = getRoomChatMessages(roomId);
      if (messages.length === 0) return;
      try {
        const { getSwarmChain } = await import("@/lib/blockchain/chain");
        const { generateTransactionId, generateTokenId } = await import("@/lib/blockchain/crypto");
        const { getActiveChain } = await import("@/lib/blockchain/multiChainManager");
        const { saveNFT } = await import("@/lib/blockchain/storage");
        const { getCurrentUser } = await import("@/lib/auth");
        const currentUser = getCurrentUser();
        if (!currentUser) return;
        const chatRecords = messages.map((m) => ({ id: m.id, sender: m.senderUsername ?? m.senderPeerId, senderId: m.senderPeerId, text: m.text, timestamp: m.ts }));
        const tokenId = generateTokenId();
        const activeChain = getActiveChain();
        const nowIso = new Date().toISOString();
        const nft = { tokenId, name: `Stream Chat: ${roomTitle}`, description: `Chat archive from live stream "${roomTitle}" — ${messages.length} messages`, attributes: [{ trait_type: "Category", value: "stream-chat" }, { trait_type: "Message Count", value: messages.length, display_type: "number" as const }, { trait_type: "Room ID", value: roomId }, { trait_type: "Post ID", value: postId }], chatRecords, roomId, postId, streamTitle: roomTitle, archivedAt: nowIso, mintedAt: nowIso, minter: currentUser.id };
        const transaction = { id: generateTransactionId(), type: "nft_mint" as const, from: "system", to: currentUser.id, tokenId, nftData: nft, timestamp: nowIso, signature: "", publicKey: currentUser.publicKey ?? currentUser.id, nonce: Date.now(), fee: 0, chainId: activeChain.chainId, meta: { nftType: "stream-chat", roomId, postId, chainId: activeChain.chainId, chainTicker: activeChain.ticker } };
        const chain = getSwarmChain();
        chain.addTransaction(transaction);
        await saveNFT(nft);
      } catch (error) {
        console.warn("[StreamingRoomTray] Failed to wrap chat into coin:", error);
      }
    },
    [],
  );

  const handleStreamEnd = useCallback(async (recording?: RecordingResult) => {
    if (!activeRoom) return;
    if (endingRoomRef.current === activeRoom.id) return;
    const roomSnapshot = activeRoom;
    const roomId = roomSnapshot.id;
    const endedAt = new Date().toISOString();
    endingRoomRef.current = roomId;
    const recordingId = await persistRecordingBlobForRoom(roomId, recording);
    const authoritativeEndedRoom = {
      ...roomSnapshot, state: "ended" as const, endedAt, participants: [],
      recording: roomSnapshot.recording || recordingId
        ? { ...(roomSnapshot.recording ?? { status: "off" as const }), recordingId: recordingId ?? roomSnapshot.recording?.recordingId }
        : roomSnapshot.recording,
      broadcast: roomSnapshot.broadcast
        ? { ...roomSnapshot.broadcast, state: "ended" as const, updatedAt: endedAt }
        : roomSnapshot.broadcast,
    };
    broadcastRoomToMesh(authoritativeEndedRoom);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("stream-room-sync", { detail: authoritativeEndedRoom }));
    }
    const promotedPostId = roomSnapshot.broadcast?.postId;
    try {
      const postEntries = await getAll<Post>("posts");
      const streamPosts = postEntries.filter((p) => p.stream?.roomId === roomId);
      for (const post of streamPosts) {
        if (!post.stream) continue;
        const updatedPost: Post = { ...post, type: "stream", stream: { roomId, title: post.stream.title ?? roomSnapshot.title, context: post.stream.context ?? roomSnapshot.context, projectId: post.stream.projectId ?? roomSnapshot.projectId ?? null, visibility: post.stream.visibility ?? roomSnapshot.visibility, broadcastState: "ended", promotedAt: post.stream.promotedAt ?? roomSnapshot.broadcast?.promotedAt ?? endedAt, recordingId: recordingId ?? post.stream.recordingId ?? null, summaryId: post.stream.summaryId ?? roomSnapshot.summary?.summaryId ?? null, endedAt } };
        await put("posts", updatedPost);
        announceContent(updatedPost.id);
        broadcastPost(updatedPost);
      }
      const fallbackPostId = roomSnapshot.broadcast?.postId;
      if (streamPosts.length === 0 && fallbackPostId) {
        const fallbackPost = await get<Post>("posts", fallbackPostId);
        if (fallbackPost?.stream) {
          const updatedFallback: Post = { ...fallbackPost, type: "stream", stream: { roomId, title: fallbackPost.stream.title ?? roomSnapshot.title, context: fallbackPost.stream.context ?? roomSnapshot.context, projectId: fallbackPost.stream.projectId ?? roomSnapshot.projectId ?? null, visibility: fallbackPost.stream.visibility ?? roomSnapshot.visibility, broadcastState: "ended", promotedAt: fallbackPost.stream.promotedAt ?? roomSnapshot.broadcast?.promotedAt ?? endedAt, recordingId: recordingId ?? fallbackPost.stream.recordingId ?? null, summaryId: fallbackPost.stream.summaryId ?? roomSnapshot.summary?.summaryId ?? null, endedAt } };
          await put("posts", updatedFallback);
          announceContent(updatedFallback.id);
          broadcastPost(updatedFallback);
        }
      }
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to update post:", error);
    }
    if (promotedPostId) {
      try {
        const commentCount = await convertChatToComments(roomId, promotedPostId);
        if (commentCount > 0) {
          toast.success(`${commentCount} chat messages saved as comments`);
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("p2p-comments-updated", { detail: { postId: promotedPostId } }));
        }
        await wrapChatIntoCoin(roomId, promotedPostId, roomSnapshot.title);
      } catch (error) {
        console.warn("[StreamingRoomTray] Failed to archive chat:", error);
      }
    }
    broadcastRoomEndedToMesh(roomId, { endedAt, recordingId: recordingId ?? null, room: authoritativeEndedRoom });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("stream-room-ended", { detail: { roomId, endedAt, room: authoritativeEndedRoom } }));
    }
    if (recordingId) toast.success("Recording saved to this session");
    try {
      await leaveRoom(roomId);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("stream-room-cleanup", { detail: { roomId } }));
      toast.success("Stream ended and room closed");
    } catch (error) {
      console.error("[StreamingRoomTray] Failed to end stream:", error);
      toast.error("Failed to end stream");
    } finally {
      setIsLeaving(false);
      endingRoomRef.current = null;
    }
  }, [activeRoom, leaveRoom, announceContent, broadcastPost, persistRecordingBlobForRoom, convertChatToComments, wrapChatIntoCoin]);

  const handlePromote = async () => {
    if (!activeRoom || !user) {
      toast.error("You must be signed in to promote a room");
      return;
    }
    setIsPromoting(true);
    try {
      const response = await promoteRoomToPost(activeRoom.id);
      const nowIso = new Date().toISOString();
      const promotedRoom = response.room;
      const metadata = { roomId: promotedRoom.id, title: promotedRoom.title, context: promotedRoom.context, projectId: promotedRoom.projectId ?? null, visibility: promotedRoom.visibility, broadcastState: (promotedRoom.broadcast?.state ?? "backstage") as "backstage" | "broadcast" | "ended", promotedAt: nowIso, recordingId: promotedRoom.recording?.recordingId ?? null, summaryId: promotedRoom.summary?.summaryId ?? null, endedAt: promotedRoom.broadcast?.state === "ended" ? (promotedRoom.endedAt ?? promotedRoom.broadcast?.updatedAt ?? null) : null };
      const existing = await get<Post>("posts", response.postId);
      const mergedPost: Post = existing
        ? { ...existing, type: "stream", projectId: existing.projectId ?? (metadata.context === "project" ? metadata.projectId ?? null : null), content: existing.content && existing.content.trim().length > 0 ? existing.content : metadata.title, stream: { promotedAt: existing.stream?.promotedAt ?? metadata.promotedAt, ...metadata, recordingId: metadata.recordingId ?? existing.stream?.recordingId ?? null, summaryId: metadata.summaryId ?? existing.stream?.summaryId ?? null, endedAt: existing.stream?.endedAt ?? metadata.endedAt ?? null } }
        : { id: response.postId, author: user.id, authorName: user.displayName || user.username, authorAvatarRef: user.profile?.avatarRef, authorBannerRef: user.profile?.bannerRef, authorBadgeSnapshots: undefined, projectId: metadata.context === "project" ? metadata.projectId ?? null : null, type: "stream", content: metadata.title, manifestIds: [], createdAt: nowIso, nsfw: false, likes: 0, reactions: [], comments: [], stream: metadata };
      if (!mergedPost.createdAt) mergedPost.createdAt = nowIso;
      if (existing) mergedPost.createdAt = nowIso;
      if (!mergedPost.reactions) mergedPost.reactions = [];
      if (!mergedPost.comments) mergedPost.comments = [];
      mergedPost.stream = { ...metadata, ...mergedPost.stream, promotedAt: mergedPost.stream?.promotedAt ?? metadata.promotedAt, recordingId: metadata.recordingId ?? mergedPost.stream?.recordingId ?? null, summaryId: metadata.summaryId ?? mergedPost.stream?.summaryId ?? null, endedAt: mergedPost.stream?.endedAt ?? metadata.endedAt ?? null };
      await put("posts", mergedPost);
      announceContent(mergedPost.id);
      broadcastPost(mergedPost);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
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
    window.dispatchEvent(new CustomEvent("stream-record-toggle", { detail: { roomId: activeRoom.id } }));
  };

  const scrollToMessage = (msgId: string) => {
    const el = messageRefs.current.get(msgId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("bg-primary/20");
      setTimeout(() => el.classList.remove("bg-primary/20"), 1500);
    }
  };

  if (shouldHide) return null;

  // ── Compute tray style ────────────────────────────────────────────
  const getTrayStyle = (): React.CSSProperties => {
    if (fullscreen) {
      return { position: "fixed", inset: 0, zIndex: 9999 };
    }
    if (isDockedPosition(trayPosition)) {
      const base: React.CSSProperties = { position: "fixed", zIndex: 50 };
      if (trayPosition === "docked-left") return { ...base, bottom: "1rem", left: "1rem" };
      if (trayPosition === "docked-right") return { ...base, bottom: "1rem", right: "1rem" };
      return { ...base, bottom: "1rem", right: "1rem" }; // docked-bottom = default
    }
    return { position: "fixed", left: trayPosition.x, top: trayPosition.y, zIndex: 50 };
  };

  // ── Participant video grid ────────────────────────────────────────
  const renderParticipantGrid = () => {
    const allPeers = webrtcParticipants;
    const sorted = pinnedPeerId
      ? [...allPeers].sort((a, b) => (a.peerId === pinnedPeerId ? -1 : b.peerId === pinnedPeerId ? 1 : 0))
      : allPeers;

    const gridCols =
      sorted.length <= 1 ? "grid-cols-1" :
      sorted.length <= 4 ? "grid-cols-2" : "grid-cols-3";

    return (
      <div className={cn("grid gap-2", gridCols)}>
        {sorted.map((p) => {
          const isPinned = pinnedPeerId === p.peerId;
          const isSpeaking = activeSpeaker === p.peerId;
          return (
            <div
              key={p.peerId}
              className={cn(
                "relative aspect-video w-full overflow-hidden rounded-lg bg-black transition-all",
                isPinned && "col-span-full",
                isSpeaking && "ring-2 ring-primary",
              )}
            >
              {p.stream && p.stream.getVideoTracks().length > 0 ? (
                <video
                  autoPlay
                  playsInline
                  className="h-full w-full object-cover"
                  ref={(el) => {
                    if (!el || !p.stream) return;
                    if (el.srcObject !== p.stream) el.srcObject = p.stream;
                    void el.play().catch(() => {});
                  }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-muted">
                  <CameraOff className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-foreground/80 backdrop-blur">
                <span>{p.username}</span>
                {p.isMuted && <MicOff className="h-3 w-3 text-destructive" />}
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1 h-6 w-6 bg-black/40 text-foreground/70 hover:text-foreground"
                onClick={() => setPinnedPeerId(isPinned ? null : p.peerId)}
                title={isPinned ? "Unpin" : "Pin"}
              >
                <span className="text-[10px]">{isPinned ? "📌" : "📍"}</span>
              </Button>
            </div>
          );
        })}
        {/* Screen shares */}
        {webrtcParticipants.filter((p) => p.screenStream && p.screenStream.getVideoTracks().length > 0).map((p) => (
          <div key={`screen-${p.peerId}`} className="relative col-span-full aspect-video w-full overflow-hidden rounded-lg border border-primary/30 bg-black">
            <video
              autoPlay playsInline
              className="h-full w-full object-contain"
              ref={(el) => {
                if (!el || !p.screenStream) return;
                if (el.srcObject !== p.screenStream) el.srcObject = p.screenStream;
                void el.play().catch(() => {});
              }}
            />
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold backdrop-blur">
              <MonitorUp className="h-3 w-3 text-primary" />
              <span className="text-primary">{p.username}&apos;s Screen</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ── Chat messages ─────────────────────────────────────────────────
  const renderChat = (height: string) => (
    <div className="flex h-full flex-col">
      <div ref={chatScrollAreaRef} className="min-h-0 flex-1">
        <ScrollArea className={cn("rounded-md border border-white/10", height)}>
          <div className="space-y-2 p-3">
            {chatMessages.map((message) => {
              const isSelf = message.senderUserId === user?.id;
              const senderLabel = isSelf ? "You" : message.senderUsername ?? message.senderUserId ?? message.senderPeerId;
              const isLong = message.text.length > LONG_MESSAGE_THRESHOLD;
              const isExpanded = expandedMessages.has(message.id);
              const displayText = isLong && !isExpanded ? message.text.slice(0, LONG_MESSAGE_THRESHOLD) + "…" : message.text;

              return (
                <div
                  key={message.id}
                  ref={(el) => { if (el) messageRefs.current.set(message.id, el); }}
                  className={cn(
                    "group rounded-md border border-white/10 px-2 py-1.5 text-xs transition-colors",
                    isSelf ? "bg-white/10" : "bg-black/20",
                  )}
                >
                  {/* Reply stamp */}
                  {message.replyToId && (
                    <button
                      type="button"
                      onClick={() => scrollToMessage(message.replyToId!)}
                      className="mb-1 flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary"
                    >
                      <CornerDownRight className="h-3 w-3" />
                      <span className="truncate">@{message.replyToUsername}: &ldquo;{(message.replyToPreview ?? "").slice(0, 150)}&rdquo;</span>
                    </button>
                  )}
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-foreground/60">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar avatarRef={message.senderAvatarRef} username={message.senderUserId ?? message.senderPeerId} displayName={senderLabel} size="sm" />
                      <span className="truncate font-medium">{senderLabel}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>{new Date(message.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <button
                        type="button"
                        onClick={() => setReplyTo({ id: message.id, username: senderLabel, preview: message.text.slice(0, 150) })}
                        className="hidden text-foreground/40 hover:text-foreground group-hover:inline-flex"
                        title="Reply"
                      >
                        <MessageSquareReply className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">{displayText}</p>
                  {isLong && (
                    <button
                      type="button"
                      onClick={() => setExpandedMessages((prev) => {
                        const next = new Set(prev);
                        if (next.has(message.id)) next.delete(message.id);
                        else next.add(message.id);
                        return next;
                      })}
                      className="mt-1 text-xs text-primary/70 hover:text-primary"
                    >
                      {isExpanded ? "Show less" : "Read more"}
                    </button>
                  )}
                </div>
              );
            })}
            {chatMessages.length === 0 && (
              <div className="py-8 text-center text-sm text-foreground/60">No messages yet — start the conversation.</div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Reply banner */}
      {replyTo && (
        <div className="flex items-center gap-2 border-t border-white/10 bg-primary/10 px-3 py-1.5 text-xs text-foreground/70">
          <CornerDownRight className="h-3 w-3 shrink-0 text-primary" />
          <span className="min-w-0 truncate">Replying to @{replyTo.username}: &ldquo;{replyTo.preview.slice(0, 80)}&rdquo;</span>
          <button type="button" onClick={() => setReplyTo(null)} className="ml-auto shrink-0 text-foreground/40 hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <form onSubmit={handleSendChatMessage} className="flex gap-2 pt-2">
        <textarea
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              doSendChat();
            }
          }}
          placeholder="Type a message… (Shift+Enter for newline)"
          className="min-h-[36px] max-h-24 flex-1 resize-none rounded-md border border-white/15 bg-black/20 px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-white/30"
          maxLength={10000}
          rows={1}
        />
        <Button type="submit" size="sm" disabled={!chatInput.trim()} className="self-end">Send</Button>
      </form>
    </div>
  );

  // ── Host controls bar ─────────────────────────────────────────────
  const renderHostControls = () => (
    <div className="flex flex-wrap gap-2">
      {canModerate && (
        <>
          <Button type="button" size="sm" variant={isPromoted ? "outline" : "secondary"} onClick={handlePromote} disabled={isPromoting || isPromoted || activeRoom!.visibility !== "public"} className={cn("gap-2", isPromoted && "opacity-70 cursor-default")}>
            {isPromoted ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Upload className="h-3.5 w-3.5" />}
            {isPromoted ? "PROMOTED" : "Promote to feed"}
          </Button>
          <Button type="button" size="sm" variant={isRecordingActive ? "destructive" : "outline"} onClick={handleRecordingToggle} className="gap-2">
            <Radio className="h-3.5 w-3.5" />
            {isRecordingActive ? "Stop" : "Record"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setIsInviteModalOpen(true)} className="gap-2">
            <UserPlus className="h-3.5 w-3.5" />
            Invite
          </Button>
        </>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={handleLeaveRoom} disabled={isLeaving} className="gap-2 text-foreground/80">
        <LogOut className="h-3.5 w-3.5" />
        Leave
      </Button>
    </div>
  );

  // ── FULLSCREEN LAYOUT ─────────────────────────────────────────────
  if (fullscreen) {
    return (
      <div style={getTrayStyle()} className="flex flex-col bg-background">
        {/* Persistent audio always mounted */}
        <PersistentAudioLayer roomId={activeRoom.id} />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-foreground">{activeRoom.title}</p>
            <Badge variant="secondary" className="capitalize">{STATUS_LABELS[activeRoom.state] ?? activeRoom.state}</Badge>
            <div className="flex items-center gap-1 text-xs text-foreground/60"><Users className="h-3.5 w-3.5" /><span>{participants.length}</span></div>
          </div>
          <div className="flex items-center gap-2">
            {renderHostControls()}
            <Button type="button" size="icon" variant="ghost" onClick={handleToggleFullscreen} className="text-foreground/70 hover:text-foreground">
              <Minimize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Main area */}
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={80} minSize={70}>
              <div className="flex h-full flex-col p-4">
                <LiveStreamControls roomId={activeRoom.id} isHost={canModerate} onStreamStart={handleStreamStart} onStreamPause={handleStreamPause} onStreamResume={handleStreamResume} onStreamEnd={handleStreamEnd} onRecordingStateChange={setIsRecordingActive} />
                <div className="mt-4 min-h-0 flex-1 overflow-auto">
                  {renderParticipantGrid()}
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
              <div className="flex h-full flex-col p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-foreground/50">Chat</p>
                {renderChat("h-full")}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {activeRoom && <InviteUsersModal isOpen={isInviteModalOpen} onClose={() => setIsInviteModalOpen(false)} roomId={activeRoom.id} roomTitle={activeRoom.title} />}
      </div>
    );
  }

  // ── NORMAL / DOCKED LAYOUT ────────────────────────────────────────
  return (
    <div ref={trayRef} style={getTrayStyle()} className={cn("w-full transition-all duration-300 max-w-sm")}>
      {/* Persistent audio — always mounted regardless of collapse */}
      <PersistentAudioLayer roomId={activeRoom.id} />

      <Card className={cn(
        "flex flex-col overflow-hidden border border-[hsla(174,59%,56%,0.35)] bg-[hsla(245,70%,8%,0.85)] shadow-xl backdrop-blur transition-all duration-300",
        "max-h-[calc(100vh-2rem)]",
      )}>
        {/* Drag handle + header */}
        <div
          className="flex cursor-grab items-center justify-between border-b border-white/10 px-4 py-3 active:cursor-grabbing"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
        >
          <div className="flex items-center gap-2">
            <GripHorizontal className="h-4 w-4 text-foreground/30" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/60">Live Rooms</p>
              {activeRoom ? (
                <div className="mt-1 space-y-1">
                  <p className="text-sm font-medium text-foreground">{activeRoom.title}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
                    <Badge variant="secondary" className="capitalize">{STATUS_LABELS[activeRoom.state] ?? activeRoom.state}</Badge>
                    <Badge variant="outline" className="capitalize">{activeRoom.visibility.replace("-", " ")}</Badge>
                    <div className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /><span>{participants.length}</span></div>
                    {isRecordingActive && <Badge variant="destructive">Recording</Badge>}
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-sm text-foreground/70">Select a room to join</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            {activeRoom && (
              <>
                <Button type="button" size="icon" variant="ghost" onClick={handleToggleFullscreen} aria-label="Fullscreen" className="text-foreground/70 hover:text-foreground">
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button type="button" size="icon" variant="ghost" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "Expand" : "Collapse"} className="text-foreground/70 hover:text-foreground">
              {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Collapsed: show listening indicator */}
        {collapsed && activeRoom && (
          <div className="flex items-center justify-between px-4 py-2 text-xs text-foreground/60">
            <div className="flex items-center gap-2">
              <Volume2 className="h-3.5 w-3.5 animate-pulse text-primary" />
              <span>Listening…</span>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={handleLeaveRoom} disabled={isLeaving} className="h-6 gap-1 px-2 text-xs text-foreground/60">
              <LogOut className="h-3 w-3" /> Leave
            </Button>
          </div>
        )}

        {!collapsed && (
          <div className="space-y-4 overflow-y-auto px-4 py-3">
            {activeRoom ? (
              <div className="space-y-3">
                {renderHostControls()}

                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="participants">
                      <Users className="mr-2 h-3.5 w-3.5" />
                      Participants ({participants.length})
                    </TabsTrigger>
                    <TabsTrigger value="chat">
                      <Radio className="mr-2 h-3.5 w-3.5" />
                      Chat ({chatMessages.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="participants" className="mt-3 space-y-3">
                    {/* Unified video grid + media controls */}
                    <LiveStreamControls
                      roomId={activeRoom.id}
                      isHost={canModerate}
                      onStreamStart={handleStreamStart}
                      onStreamPause={handleStreamPause}
                      onStreamResume={handleStreamResume}
                      onStreamEnd={handleStreamEnd}
                      onRecordingStateChange={setIsRecordingActive}
                    />

                    {/* Participant list with moderation */}
                    <ScrollArea className={cn("rounded-md border border-white/10 max-h-60")}>
                      <div className="divide-y divide-white/5">
                        {participants.map((participant) => {
                          const isSelf = participant.userId === user?.id;
                          const audioMuted = participant.audioMuted;
                          const videoMuted = participant.videoMuted;
                          return (
                            <div key={participant.peerId} className={cn("flex items-center justify-between gap-3 px-3 py-2 text-sm", isSelf ? "bg-white/5" : undefined)}>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-foreground">{participant.handle}</span>
                                  <Badge variant="outline" className="capitalize">{participant.role}</Badge>
                                  {isSelf && <Badge variant="secondary">You</Badge>}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-foreground/60">
                                  <span className="flex items-center gap-1">{audioMuted ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}{audioMuted ? "Muted" : "Live"}</span>
                                  <span className="flex items-center gap-1">{videoMuted ? <VideoOff className="h-3 w-3" /> : <Video className="h-3 w-3" />}{videoMuted ? "Off" : "On"}</span>
                                </div>
                              </div>
                              {canModerate && !isSelf && (
                                <div className="flex items-center gap-1">
                                  <Button type="button" size="icon" variant="ghost" onClick={() => handleToggleMute(participant.peerId, audioMuted)} disabled={moderatingPeerId === participant.peerId} aria-label={audioMuted ? "Unmute" : "Mute"} className="h-8 w-8">
                                    {audioMuted ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                                  </Button>
                                  <Button type="button" size="icon" variant="ghost" onClick={() => handleToggleVideo(participant.peerId, videoMuted)} disabled={moderatingPeerId === participant.peerId} aria-label={videoMuted ? "Enable video" : "Disable video"} className="h-8 w-8">
                                    {videoMuted ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
                                  </Button>
                                  <Button type="button" size="icon" variant="ghost" onClick={() => handleBanParticipant(participant.peerId)} disabled={moderatingPeerId === participant.peerId} aria-label="Remove" className="h-8 w-8">
                                    <Ban className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {participants.length === 0 && (
                          <div className="px-3 py-6 text-center text-sm text-foreground/60">Waiting for participants…</div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="chat" className="mt-3">
                    {renderChat("h-60")}
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
            {activeRoom && canModerate && activeRoom.visibility !== "public" && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Only public streams can be promoted to the Home and Most Recent feeds.
              </div>
            )}
          </div>
        )}
      </Card>

      {activeRoom && <InviteUsersModal isOpen={isInviteModalOpen} onClose={() => setIsInviteModalOpen(false)} roomId={activeRoom.id} roomTitle={activeRoom.title} />}
    </div>
  );
}
