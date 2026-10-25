import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AtSign,
  CornerDownRight,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Send,
  Settings2,
  MessageSquare,
  Shield,
  Upload,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
  HelpCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import type { InfinityChatMode } from '@/lib/brain/infinityChatSettings';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar } from '@/components/Avatar';
import { cn } from '@/lib/utils';
import { ENTITY_DISPLAY_NAME } from '@/lib/p2p/entityVoice';
import { getSharedFieldEngine } from '@/lib/uqrc/fieldEngine';
import { useStreaming } from '@/hooks/useStreaming';
import { useAuth } from '@/hooks/useAuth';
import { useP2PContext } from '@/contexts/P2PContext';
import { get, put } from '@/lib/store';
import type { Post } from '@/types';
import { useActiveSpeaker } from '@/hooks/useActiveSpeaker';
import type { VideoParticipant } from '@/lib/webrtc/types';
import type { BrainVoicePeer } from '@/hooks/useBrainVoice';
import type { BrainVariantCapabilities } from '@/lib/brain/variants';
import { getRoomChatMessages } from '@/lib/streaming/webrtcSignalingBridge.standalone';
import {
  getChatHistoryCoins,
  wrapChatHistoryIntoCoin,
} from '@/lib/blockchain/chatCoinWrap';
import type { SwarmCoin } from '@/lib/blockchain/types';
import { useIsMobile } from '@/hooks/use-mobile';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { isPeerMuted, mutePeer, unmutePeer, useMutedPeers } from '@/lib/brain/mutedPeersStore';

export interface BrainChatLine {
  id: string;
  author: string;
  text: string;
  ts: number;
  /** Original peerId/userId of the sender, used for avatar lookup. */
  authorId?: string;
  /** WebRTC peer id of the sender (remote lines only) — used for mute/block. */
  peerId?: string;
  avatarRef?: string;
  infinityReplyTo?: string;
  replyTo?: { id: string; author: string; preview: string };
}

const MAX_LEN = 8000;
const LONG_MESSAGE_THRESHOLD = 2400;

/**
 * CommonMark collapses single newlines inside a paragraph, which flattens
 * multi-line chat messages into one run-on line. Convert each non-empty
 * source line into its own paragraph so typed line breaks render as breaks.
 */
function formatChatMarkdown(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n\n');
}

interface Props {
  lines: BrainChatLine[];
  onSend: (text: string, replyTo?: BrainChatLine['replyTo']) => void;
  onClose?: () => void;
  /** Voice peers from useBrainVoice — drives the users rail. */
  voicePeers?: BrainVoicePeer[];
  /** Raw WebRTC participants — drives mic/camera/active-speaker indicators. */
  rtcParticipants?: VideoParticipant[];
  /** True when the local mic is unmuted. Drives the "Voice on" pill. */
  voiceOn?: boolean;
  /** Active room id this panel is bound to (for promote-to-feed match). */
  roomId?: string;
  /** Variant: floating (in-scene), modal launcher, or embedded inside a
   *  parent surface (e.g. the LivePostBox feed card). */
  variant?: 'floating' | 'modal' | 'embedded';
  /** 'brain' (default) shows Infinity affordances; 'classic' hides the
   *  Infinity persona, voice toggle, and any mentions of the entity. Used
   *  by Live-Stream post boxes so live chats don't impersonate the lobby. */
  chatMode?: 'brain' | 'classic';
  /** Capability flags from the parent BrainVariant. When omitted (e.g. the
   *  global launcher tray), promote falls back to "any active room hosted
   *  by the local user", preserving legacy behavior. */
  variantCapabilities?: BrainVariantCapabilities;
  /** Whether Infinity's spoken voice is currently enabled. */
  infinityVoiceEnabled?: boolean;
  /** Toggle Infinity's spoken voice (mute/unmute the audio reply). */
  onToggleInfinityVoice?: () => void;
  infinityChatMode?: InfinityChatMode;
  onInfinityChatModeChange?: (mode: InfinityChatMode) => void;
  infinitySyncRequested?: boolean;
  onInfinitySyncChoice?: (accept: boolean) => void;
}

/**
 * Brain Chat — replaces the legacy Live Chat tray.
 * • Bigger, resizable, fullscreen-capable.
 * • Markdown messages, multi-line composer up to 8000 chars.
 * • Users rail with mic/camera + active-speaker ring.
 * • Promote-to-feed when a live room is bound to this Brain room.
 */
export function BrainChatPanel({
  lines,
  onSend,
  onClose,
  voicePeers = [],
  rtcParticipants = [],
  voiceOn = false,
  roomId,
  variant = 'floating',
  chatMode = 'brain',
  variantCapabilities,
  infinityVoiceEnabled,
  onToggleInfinityVoice,
  infinityChatMode = 'off',
  onInfinityChatModeChange,
  infinitySyncRequested = false,
  onInfinitySyncChoice,
}: Props) {
  const { user } = useAuth();
  const { activeRoom, promoteRoomToPost } = useStreaming();
  const { broadcastPost, announceContent, getPeerId, blocklist, blockPeer, unblockPeer } = useP2PContext();
  const mutedPeers = useMutedPeers();
  const blockedIds = useMemo(() => new Set(blocklist.map((e) => e.peerId)), [blocklist]);
  const isMobile = useIsMobile();
  const [text, setText] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [replyTo, setReplyTo] = useState<BrainChatLine['replyTo'] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [seededLines, setSeededLines] = useState<BrainChatLine[]>([]);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isPromoted, setIsPromoted] = useState(false);
  // ── Chat history coins ───────────────────────────────────────────
  // Engagement anchors when the local user first sends a message; saving
  // seals everything from that point into a mined SWARM coin they own.
  // (Handlers are defined after `allLines` below.)
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Drag-to-reposition (mobile only). Header is the drag handle.
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (fullscreen) return;
      // Don't hijack taps on header buttons.
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: dragOffset.x,
        baseY: dragOffset.y,
      };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [fullscreen, dragOffset.x, dragOffset.y],
  );

  const handleHeaderPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    setDragOffset({ x: s.baseX + dx, y: s.baseY + dy });
  }, []);

  const handleHeaderPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    dragStateRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  // Reset offset when entering fullscreen.
  useEffect(() => {
    if (fullscreen) setDragOffset({ x: 0, y: 0 });
  }, [fullscreen]);

  const activeSpeaker = useActiveSpeaker(rtcParticipants);

  // ── Promote-to-feed gating ───────────────────────────────────────
  // Show whenever a live room is active AND the local user appears to be
  // its host. We don't require activeRoom.id === roomId — the Brain scene
  // may be bound to a universe-shared id while the live room has its own
  // UUID. If we can't confirm host identity, fall back to "any participant
  // with an active room can promote" — the API enforces auth server-side.
  const localPeerId = (() => { try { return getPeerId?.() ?? null; } catch { return null; } })();
  const isHost = Boolean(
    activeRoom && (
      (localPeerId && activeRoom.hostPeerId === localPeerId) ||
      // If host id isn't known on the client, allow promote — server gates it.
      !localPeerId
    ),
  );
  // When the parent BrainVariant declares capabilities, gate on its
  // `promoteToFeed` flag. Otherwise fall back to the legacy heuristic so
  // the standalone launcher tray keeps working.
  const promoteAllowedByVariant = variantCapabilities
    ? variantCapabilities.promoteToFeed
    : true;
  const promoteVisible = promoteAllowedByVariant && Boolean(activeRoom) && isHost;
  useEffect(() => {
    setIsPromoted(Boolean(activeRoom?.broadcast?.postId));
  }, [activeRoom?.id, activeRoom?.broadcast?.postId]);

  // ── History seed: hydrate from the room chat log on mount ────────
  useEffect(() => {
    if (!roomId) {
      setSeededLines([]);
      return;
    }
    try {
      const history = getRoomChatMessages(roomId);
      // Infinity replies pass through the scene's consent gate, not hydration.
      const seeded: BrainChatLine[] = history.filter((m) => !m.infinityReplyTo).map((m) => ({
        id: m.id,
        author: m.senderUsername || m.senderPeerId.slice(0, 8),
        text: m.text.includes('\u0001') ? m.text.split('\u0001').slice(1).join('\u0001') : m.text,
        ts: m.ts,
        authorId: m.senderUserId ?? m.senderPeerId,
        avatarRef: m.senderAvatarRef,
        replyTo: m.replyToId
          ? { id: m.replyToId, author: m.replyToUsername ?? '', preview: m.replyToPreview ?? '' }
          : undefined,
      }));
      setSeededLines(seeded);
    } catch {
      setSeededLines([]);
    }
  }, [roomId]);

  // Merge seeded + live lines, dedup by id.
  const allLines = useMemo(() => {
    const map = new Map<string, BrainChatLine>();
    for (const l of seededLines) map.set(l.id, l);
    for (const l of lines) map.set(l.id, l);
    return [...map.values()].sort((a, b) => a.ts - b.ts);
  }, [seededLines, lines]);

  // ── Mute / Block ─────────────────────────────────────────────────
  // Mute is a local-only presentation filter (mutedPeersStore); Block is
  // the network-level P2P blocklist. Blocking also writes a mute entry so
  // every render filter (avatar, video, audio, placements) only has to
  // consult the one store.
  const lineHiddenStatus = useCallback(
    (line: BrainChatLine): 'muted' | 'blocked' | null => {
      const ids = [line.peerId, line.authorId].filter((v): v is string => Boolean(v));
      if (ids.some((id) => blockedIds.has(id))) return 'blocked';
      if (ids.some((id) => mutedPeers.some((e) => e.peerId === id || e.userId === id))) return 'muted';
      return null;
    },
    [blockedIds, mutedPeers],
  );

  type RenderedLine =
    | { kind: 'line'; line: BrainChatLine }
    | { kind: 'placeholder'; key: string; status: 'muted' | 'blocked'; line: BrainChatLine };
  // Hidden users collapse into ONE placeholder at their first hidden
  // message; every later message of theirs stays invisible.
  const renderedLines = useMemo<RenderedLine[]>(() => {
    const out: RenderedLine[] = [];
    const shown = new Set<string>();
    for (const line of allLines) {
      const status = lineHiddenStatus(line);
      if (!status) {
        out.push({ kind: 'line', line });
        continue;
      }
      const key = line.authorId ?? line.peerId ?? line.author;
      if (shown.has(key)) continue;
      shown.add(key);
      out.push({ kind: 'placeholder', key, status, line });
    }
    return out;
  }, [allLines, lineHiddenStatus]);

  const handleUnhide = useCallback(
    (status: 'muted' | 'blocked', line: BrainChatLine) => {
      if (status === 'blocked') {
        const target = line.peerId ?? line.authorId;
        if (target) unblockPeer(target);
      }
      if (line.peerId) unmutePeer(line.peerId);
      if (line.authorId) unmutePeer(line.authorId);
    },
    [unblockPeer],
  );

  /** Shared Mute/Block menu content for a name click (messages + rail). */
  const renderUserTools = (username: string, peerId?: string, userId?: string) => {
    const ids = [peerId, userId].filter((v): v is string => Boolean(v));
    const muted = ids.some((id) => isPeerMuted(id));
    const blocked = ids.some((id) => blockedIds.has(id));
    const itemClass =
      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/80 transition-colors hover:bg-white/10';
    return (
      <PopoverContent align="start" className="w-52 p-1">
        <p className="truncate px-2 py-1 text-[11px] font-medium text-foreground/70">@{username}</p>
        <button type="button" className={itemClass} onClick={() => insertMention(username)}>
          <AtSign className="h-3.5 w-3.5" /> Mention
        </button>
        <button
          type="button"
          className={itemClass}
          onClick={() => {
            if (muted) {
              ids.forEach((id) => unmutePeer(id));
            } else {
              mutePeer({ peerId, userId, username });
            }
          }}
        >
          <VolumeX className="h-3.5 w-3.5" /> {muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          type="button"
          className={cn(itemClass, 'text-destructive')}
          onClick={() => {
            const target = peerId ?? userId;
            if (!target) return;
            if (blocked) {
              unblockPeer(target);
              ids.forEach((id) => unmutePeer(id));
            } else {
              blockPeer(target, 'all', 'Blocked from Brain chat');
              mutePeer({ peerId, userId, username });
            }
          }}
        >
          <Shield className="h-3.5 w-3.5" /> {blocked ? 'Unblock' : 'Block'}
        </button>
        <p className="px-2 py-1 text-[10px] leading-snug text-foreground/40">
          Mute hides their audio, video, avatar, builds and chat on this device. Block cuts them off from your node entirely.
        </p>
      </PopoverContent>
    );
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [allLines]);

  // ── Chat history coins ───────────────────────────────────────────
  const engagedAtRef = useRef<number | null>(null);
  const [isSavingHistory, setIsSavingHistory] = useState(false);
  const [historyCoins, setHistoryCoins] = useState<SwarmCoin[]>([]);
  const [viewingCoin, setViewingCoin] = useState<SwarmCoin | null>(null);
  useEffect(() => {
    engagedAtRef.current = null;
    setViewingCoin(null);
  }, [roomId, user?.id]);

  const refreshHistoryCoins = useCallback(async () => {
    if (!user) { setHistoryCoins([]); return; }
    try { setHistoryCoins(await getChatHistoryCoins(user.id)); } catch { setHistoryCoins([]); }
  }, [user]);

  useEffect(() => { void refreshHistoryCoins(); }, [refreshHistoryCoins]);

  const handleSaveHistory = useCallback(async () => {
    if (!user || !roomId || engagedAtRef.current == null || isSavingHistory) return;
    setIsSavingHistory(true);
    try {
      const engagedAt = engagedAtRef.current;
      if (engagedAt == null) return;
      const engaged = allLines.filter((l) => l.ts >= engagedAt);
      if (!engaged.length) {
        toast.error('Nothing to save yet — send a message first.');
        return;
      }
      const { coin } = await wrapChatHistoryIntoCoin(
        user.id,
        roomId,
        engaged.map((l) => ({ author: l.author, text: l.text, ts: l.ts })),
      );
      engagedAtRef.current = null;
      await refreshHistoryCoins();
      toast.success(`Chat history sealed into coin ${coin.coinId.slice(-6)} — it stays in your wallet.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save chat history');
    } finally {
      setIsSavingHistory(false);
    }
  }, [user, roomId, isSavingHistory, allLines, refreshHistoryCoins]);

  // ESC exits fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (engagedAtRef.current == null) engagedAtRef.current = Date.now();
    onSend(trimmed.slice(0, MAX_LEN), replyTo ?? undefined);
    setText('');
    setReplyTo(null);
    try { getSharedFieldEngine().inject(trimmed, { amplitude: 0.2 }); } catch { /* ignore */ }
  }, [text, onSend, replyTo]);

  const insertMention = useCallback((username: string) => {
    setText((prev) => {
      const tag = `@${username} `;
      if (prev.endsWith(' ') || prev.length === 0) return prev + tag;
      return prev + ' ' + tag;
    });
    composerRef.current?.focus();
  }, []);

  const scrollToMessage = (id: string) => {
    const el = messageRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('bg-primary/20');
      setTimeout(() => el.classList.remove('bg-primary/20'), 1500);
    }
  };

  // ── Promote to feed ──────────────────────────────────────────────
  const handlePromote = async () => {
    if (!activeRoom || !user) {
      toast.error('Sign in to promote');
      return;
    }
    setIsPromoting(true);
    try {
      const response = await promoteRoomToPost(activeRoom.id);
      const nowIso = new Date().toISOString();
      const promotedRoom = response.room;
      const metadata = {
        roomId: promotedRoom.id,
        title: promotedRoom.title,
        context: promotedRoom.context,
        projectId: promotedRoom.projectId ?? null,
        visibility: promotedRoom.visibility,
        broadcastState: (promotedRoom.broadcast?.state ?? 'backstage') as 'backstage' | 'broadcast' | 'ended',
        promotedAt: nowIso,
        recordingId: promotedRoom.recording?.recordingId ?? null,
        summaryId: promotedRoom.summary?.summaryId ?? null,
        endedAt: promotedRoom.broadcast?.state === 'ended'
          ? (promotedRoom.endedAt ?? promotedRoom.broadcast?.updatedAt ?? null)
          : null,
      };
      const existing = await get<Post>('posts', response.postId);
      const mergedPost: Post = existing
        ? { ...existing, type: 'stream', content: existing.content?.trim() ? existing.content : metadata.title, stream: { ...metadata, ...(existing.stream ?? {}), promotedAt: existing.stream?.promotedAt ?? metadata.promotedAt } }
        : {
            id: response.postId,
            author: user.id,
            authorName: user.displayName || user.username,
            authorAvatarRef: user.profile?.avatarRef,
            authorBannerRef: user.profile?.bannerRef,
            authorBadgeSnapshots: undefined,
            projectId: metadata.context === 'project' ? metadata.projectId ?? null : null,
            type: 'stream',
            content: metadata.title,
            manifestIds: [],
            createdAt: nowIso,
            nsfw: false,
            likes: 0,
            reactions: [],
            comments: [],
            stream: metadata,
          };
      await put('posts', mergedPost);
      announceContent(mergedPost.id);
      broadcastPost(mergedPost);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('p2p-posts-updated'));
      toast.success('Live room promoted to feed');
      setIsPromoted(true);
    } catch (error) {
      console.error('[BrainChatPanel] promote failed', error);
      toast.error(error instanceof Error ? error.message : 'Promote failed');
    } finally {
      setIsPromoting(false);
    }
  };

  // ── Users rail: dedup voicePeers ∪ rtcParticipants ───────────────
  type RailUser = {
    peerId: string;
    username: string;
    avatarRef?: string;
    avatarId?: string;
    micOn: boolean;
    cameraOn: boolean;
    isSpeaking: boolean;
  };
  const railUsers: RailUser[] = useMemo(() => {
    const byId = new Map<string, RailUser>();
    for (const p of voicePeers) {
      byId.set(p.peerId, {
        peerId: p.peerId,
        username: p.username,
        avatarId: p.avatarId,
        micOn: true,
        cameraOn: false,
        isSpeaking: activeSpeaker === p.peerId,
      });
    }
    for (const p of rtcParticipants) {
      const cur = byId.get(p.peerId);
      const merged: RailUser = {
        peerId: p.peerId,
        username: cur?.username ?? p.username ?? p.peerId.slice(0, 8),
        avatarId: cur?.avatarId,
        micOn: !p.isMuted,
        cameraOn: Boolean(p.stream && p.stream.getVideoTracks().length > 0),
        isSpeaking: activeSpeaker === p.peerId,
      };
      byId.set(p.peerId, merged);
    }
    return [...byId.values()];
  }, [voicePeers, rtcParticipants, activeSpeaker]);

  // ── Layout sizing ────────────────────────────────────────────────
  // Fullscreen keeps the same translucent glass treatment as the floating
  // panel so the 3-D scene (and the joystick layered behind it) remain
  // visible. We also leave ~5.5rem of empty space at the bottom on mobile
  // and 4rem on desktop so the joystick stays interactive underneath.
  const isClassic = chatMode === 'classic';
  const showInfinityVoice = !isClassic && infinityChatMode === 'audio' && Boolean(onToggleInfinityVoice);
  const showInfinitySettings = !isClassic && Boolean(onInfinityChatModeChange);
  const isEmbedded = variant === 'embedded';
  const containerClass = isEmbedded
    ? cn(
        'relative z-0 flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-[hsla(180,80%,60%,0.18)] bg-[hsla(265,70%,8%,0.55)]',
      )
    : fullscreen
    ? cn(
        'fixed z-[60] flex flex-col rounded-2xl border border-[hsla(180,80%,60%,0.25)] bg-[hsla(265,70%,8%,0.55)] shadow-2xl',
        // Clear the top HUD bar (~3.5rem) and reserve corner space so the
        // joysticks (bottom-left desktop, bottom-right mobile, ~7rem each)
        // remain fully visible and interactive at any viewport size.
        'top-14',
        isMobile
          ? 'left-2 right-[7.5rem] bottom-[calc(7.5rem+env(safe-area-inset-bottom))]'
          : 'left-[7.5rem] right-2 bottom-[7.5rem]',
      )
    : variant === 'modal'
      ? cn(
          'fixed z-[40] flex flex-col rounded-2xl border border-[hsla(180,80%,60%,0.25)] bg-[hsla(265,70%,8%,0.55)] shadow-2xl',
          isMobile
            ? 'inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))]'
            : 'bottom-20 right-4',
        )
      : cn(
          'z-30 flex flex-col rounded-2xl border border-[hsla(180,80%,60%,0.25)] bg-[hsla(265,70%,8%,0.55)] shadow-2xl',
          isMobile
            ? 'fixed inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))]'
            : 'absolute bottom-4 left-4',
        );

  const containerStyle: React.CSSProperties = isEmbedded
    ? {}
    : fullscreen
    ? {}
    : isMobile
    ? {
        height: 'min(72vh, 560px)',
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        touchAction: 'none',
      }
    : {
        width: 'min(560px, calc(100vw - 2rem))',
        height: 'min(60vh, 520px)',
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        touchAction: 'none',
      };

  return (
    <Tabs defaultValue="chat" className={containerClass} style={containerStyle}>
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between border-b border-[hsla(180,80%,60%,0.18)] px-3 py-2',
          !fullscreen && !isEmbedded && 'cursor-grab active:cursor-grabbing touch-none select-none',
        )}
        onPointerDown={isEmbedded ? undefined : handleHeaderPointerDown}
        onPointerMove={isEmbedded ? undefined : handleHeaderPointerMove}
        onPointerUp={isEmbedded ? undefined : handleHeaderPointerEnd}
        onPointerCancel={isEmbedded ? undefined : handleHeaderPointerEnd}
      >
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs font-display uppercase tracking-[0.2em] text-foreground/80">
            {isClassic ? 'Live Chat' : 'Brain Chat'}
          </span>
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Users className="h-3 w-3" /> {railUsers.length}
          </Badge>
          {voiceOn ? (
            <Badge variant="outline" className="gap-1 border-primary/40 text-[10px] text-primary">
              <Mic className="h-3 w-3" /> Voice on
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-destructive/50 text-[10px] text-destructive">
              <MicOff className="h-3 w-3" /> Mic muted
            </Badge>
          )}
          {showInfinityVoice && infinityVoiceEnabled === false && (
            <Badge variant="outline" className="hidden sm:flex gap-1 border-accent text-[10px] text-accent">
              <VolumeX className="h-3 w-3" /> Infinity silenced
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {promoteVisible && (
            isMobile ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant={isPromoted ? 'outline' : 'secondary'}
                      onClick={handlePromote}
                      disabled={isPromoting || isPromoted}
                      className="h-8 w-8"
                      aria-label="Promote to feed"
                    >
                      <Upload className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isPromoted ? 'Promoted' : 'Promote to feed'}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Button
                type="button"
                size="sm"
                variant={isPromoted ? 'outline' : 'secondary'}
                onClick={handlePromote}
                disabled={isPromoting || isPromoted}
                className="h-7 gap-1 text-xs"
                aria-label="Promote to feed"
              >
                <Upload className="h-3 w-3" />
                {isPromoted ? 'Promoted' : isPromoting ? '…' : 'Promote to feed'}
              </Button>
            )
          )}
          {!isEmbedded && <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-foreground/60 hover:text-foreground"
            onClick={() => setFullscreen((v) => !v)}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Maximize'}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>}
          {showInfinityVoice && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                'h-7 w-7',
                infinityVoiceEnabled
                  ? 'text-primary hover:text-primary'
                  : 'text-accent hover:text-accent',
              )}
              onClick={onToggleInfinityVoice}
              aria-label={infinityVoiceEnabled ? "Mute Infinity's voice" : "Unmute Infinity's voice"}
              title={infinityVoiceEnabled ? "Mute Infinity's voice" : "Unmute Infinity's voice"}
            >
              {infinityVoiceEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            </Button>
          )}
          {onClose && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-foreground/60 hover:text-foreground"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {showInfinitySettings && (
        <div className="mx-2 my-1 flex shrink-0 items-center gap-2">
          <TabsList aria-label="Brain chat views" className="h-8 justify-start">
            <TabsTrigger value="chat" className="gap-1.5 px-2 py-1 text-xs"><MessageSquare className="h-3.5 w-3.5" />Chat</TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 px-2 py-1 text-xs"><Settings2 className="h-3.5 w-3.5" />Settings</TabsTrigger>
          </TabsList>
          {engagedAtRef.current != null && !viewingCoin && user && roomId && (
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleSaveHistory}
                disabled={isSavingHistory}
                className="h-6 px-2 text-[11px]"
                aria-label="Save chat history into a mined coin"
              >
                {isSavingHistory ? 'Sealing…' : 'Save'}
              </Button>
              <span
                tabIndex={0}
                role="img"
                aria-label="Chat is ephemeral. Save seals this conversation into one of your mined coins to keep it."
                title="Chat is ephemeral — Save seals this conversation into one of your mined coins to keep it."
                className="inline-flex cursor-help text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </div>
          )}
        </div>
      )}

      <TabsContent value="chat" className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">

      {/* Body: users rail + messages */}
      <div className={cn('flex min-h-0 flex-1', isMobile && 'flex-col')}>
        {/* Users rail */}
        {isMobile ? (
          <div className="shrink-0 border-b border-[hsla(180,80%,60%,0.15)] bg-black/20">
            <div className="flex snap-x gap-2 overflow-x-auto px-2 py-1.5">
              {railUsers.length === 0 && (
                <p className="px-1 py-2 text-[10px] italic text-foreground/40">No peers yet</p>
              )}
              {railUsers.map((u) => (
                <Popover key={u.peerId}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'flex shrink-0 snap-start items-center gap-1 rounded-full bg-white/5 px-1.5 py-1 transition-colors hover:bg-white/10',
                        u.isSpeaking && 'ring-1 ring-primary',
                      )}
                      aria-label={`@${u.username} — user tools`}
                      title={`@${u.username}`}
                    >
                      <Avatar
                        avatarRef={u.avatarRef}
                        username={u.peerId}
                        displayName={u.username}
                        size="sm"
                      />
                      <div className="flex items-center gap-0.5 pr-1 text-foreground/50">
                        {u.micOn ? <Mic className="h-3 w-3 text-primary" /> : <MicOff className="h-3 w-3" />}
                        {u.cameraOn ? <Video className="h-3 w-3 text-primary" /> : <VideoOff className="h-3 w-3" />}
                        {blockedIds.has(u.peerId) ? (
                          <Shield className="h-3 w-3 text-destructive" />
                        ) : isPeerMuted(u.peerId) ? (
                          <VolumeX className="h-3 w-3 text-amber-400" />
                        ) : null}
                      </div>
                    </button>
                  </PopoverTrigger>
                  {renderUserTools(u.username, u.peerId, undefined)}
                </Popover>
              ))}
            </div>
          </div>
        ) : (
          <div className="w-[140px] shrink-0 border-r border-[hsla(180,80%,60%,0.15)] bg-black/20">
            <ScrollArea className="h-full">
              <div className="space-y-1 p-2">
                {railUsers.length === 0 && (
                  <p className="px-1 py-2 text-[10px] italic text-foreground/40">
                    No peers yet
                  </p>
                )}
                {railUsers.map((u) => (
                  <Popover key={u.peerId}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-white/5',
                          u.isSpeaking && 'ring-1 ring-primary',
                        )}
                        title={`@${u.username} — user tools`}
                      >
                        <Avatar
                          avatarRef={u.avatarRef}
                          username={u.peerId}
                          displayName={u.username}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1 truncate text-foreground/90">
                            <span className="truncate">{u.username}</span>
                            {blockedIds.has(u.peerId) ? (
                              <Shield className="h-2.5 w-2.5 shrink-0 text-destructive" />
                            ) : isPeerMuted(u.peerId) ? (
                              <VolumeX className="h-2.5 w-2.5 shrink-0 text-amber-400" />
                            ) : null}
                          </p>
                          <div className="flex items-center gap-1 text-foreground/40">
                            {u.micOn ? <Mic className="h-2.5 w-2.5 text-primary" /> : <MicOff className="h-2.5 w-2.5" />}
                            {u.cameraOn ? <Video className="h-2.5 w-2.5 text-primary" /> : <VideoOff className="h-2.5 w-2.5" />}
                          </div>
                        </div>
                      </button>
                    </PopoverTrigger>
                    {renderUserTools(u.username, u.peerId, undefined)}
                  </Popover>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {viewingCoin?.wrappedChat ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setViewingCoin(null)}
                className="mb-1 text-[11px] text-primary/70 hover:text-primary"
              >
                ← Back to live chat
              </button>
              <p className="text-[10px] uppercase tracking-wider text-foreground/50">
                Saved {new Date(viewingCoin.wrappedChat.savedAt).toLocaleString()} · {viewingCoin.wrappedChat.messageCount} messages · {viewingCoin.wrappedChat.participants.length} participants
              </p>
              {viewingCoin.wrappedChat.messages.map((m, i) => (
                <div key={`${m.ts}-${i}`} className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs">
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-foreground/60">
                    <span className="truncate font-medium">{m.author}</span>
                    <span>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="prose prose-invert prose-sm max-w-none break-words text-foreground/90 [&_a]:text-primary [&_li]:my-0.5 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{formatChatMarkdown(m.text)}</ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
          ) : allLines.length === 0 ? (
            <p className="text-sm italic text-foreground/40">
              Say hi to the room.
            </p>
          ) : (
            <div className="space-y-2">
              {renderedLines.map((entry) => {
                if (entry.kind === 'placeholder') {
                  return (
                    <div
                      key={`hidden-${entry.key}`}
                      className="rounded-md border border-white/10 bg-black/10 px-2 py-1.5 text-[11px] italic text-foreground/50"
                    >
                      Message from {entry.status} user{' '}
                      <button
                        type="button"
                        onClick={() => handleUnhide(entry.status, entry.line)}
                        className="not-italic text-primary/70 hover:text-primary"
                      >
                        ({entry.status === 'muted' ? 'Unmute?' : 'Unblock?'})
                      </button>
                    </div>
                  );
                }
                const line = entry.line;
                const isInfinity = !isClassic && line.author === ENTITY_DISPLAY_NAME;
                const hasUserTools = !isInfinity && Boolean(line.peerId || line.authorId);
                const isLong = line.text.length > LONG_MESSAGE_THRESHOLD;
                const isExpanded = expanded.has(line.id);
                const display = isLong && !isExpanded
                  ? line.text.slice(0, LONG_MESSAGE_THRESHOLD) + '…'
                  : line.text;
                return (
                  <div
                    key={line.id}
                    ref={(el) => { if (el) messageRefs.current.set(line.id, el); }}
                    className={cn(
                      'group rounded-md border border-white/10 px-2 py-1.5 text-xs transition-colors',
                      isInfinity ? 'bg-primary/10' : 'bg-black/20',
                    )}
                  >
                    {line.replyTo && (
                      <button
                        type="button"
                        onClick={() => scrollToMessage(line.replyTo!.id)}
                        className="mb-1 flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary"
                      >
                        <CornerDownRight className="h-3 w-3" />
                        <span className="truncate">@{line.replyTo.author}: &ldquo;{line.replyTo.preview.slice(0, 120)}&rdquo;</span>
                      </button>
                    )}
                    <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-foreground/60">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Avatar
                          avatarRef={line.avatarRef}
                          username={line.authorId ?? line.author}
                          displayName={line.author}
                          size="sm"
                        />
                        <span
                          className={cn(
                            'truncate font-medium',
                            isInfinity && 'text-[hsl(180,90%,70%)]',
                          )}
                        >
                          {line.author}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span>{new Date(line.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <button
                          type="button"
                          onClick={() => setReplyTo({
                            id: line.id,
                            author: line.author,
                            preview: line.text.slice(0, 150),
                          })}
                          className="inline-flex text-foreground/40 hover:text-foreground md:hidden md:group-hover:inline-flex"
                          title="Reply"
                        >
                          <CornerDownRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none min-w-0 break-words text-foreground/90 [&_a]:text-primary [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1 [&_li]:my-0.5 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:rounded-md [&_pre]:bg-black/50 [&_pre]:p-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {formatChatMarkdown(display)}
                      </ReactMarkdown>
                    </div>
                    {isLong && (
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(line.id)) next.delete(line.id);
                          else next.add(line.id);
                          return next;
                        })}
                        className="mt-1 text-[11px] text-primary/70 hover:text-primary"
                      >
                        {isExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Reply banner */}
      {!viewingCoin && infinitySyncRequested && onInfinitySyncChoice && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-muted px-3 py-2 text-xs text-foreground" role="status">
          <span className="flex-1">Peer is chatting with Infinity: View Response?</span>
          <Button type="button" size="sm" onClick={() => onInfinitySyncChoice(true)}>Accept</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onInfinitySyncChoice(false)}>Decline</Button>
        </div>
      )}
      {replyTo && (
        <div className="flex items-center gap-2 border-t border-white/10 bg-primary/10 px-3 py-1.5 text-xs text-foreground/70">
          <CornerDownRight className="h-3 w-3 shrink-0 text-primary" />
          <span className="min-w-0 truncate">Replying to @{replyTo.author}: &ldquo;{replyTo.preview.slice(0, 80)}&rdquo;</span>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="ml-auto shrink-0 text-foreground/40 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}


      {/* Composer */}
      <div className="flex shrink-0 gap-2 border-t border-[hsla(180,80%,60%,0.18)] p-2">
        <Textarea
          ref={composerRef}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={isClassic ? 'Message room…' : `Speak into the brain… (${MAX_LEN.toLocaleString()} chars · Shift+Enter for newline · Markdown supported)`}
          rows={isEmbedded ? 1 : 2}
          maxLength={MAX_LEN}
          className={cn('flex-1 resize-none text-base md:text-sm', isEmbedded ? 'max-h-24 min-h-[40px]' : 'max-h-44 min-h-[44px]')}
        />
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="self-end h-10 w-10 px-0 md:h-9 md:w-auto md:px-3"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
      </TabsContent>
      {showInfinitySettings && (
        <TabsContent value="settings" className="m-0 min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Infinity</h3>
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-3 text-sm text-foreground">
              <span className="min-w-0">Enable Infinity (with audio)</span>
              <Switch checked={infinityChatMode === 'audio'} onCheckedChange={(checked) => onInfinityChatModeChange?.(checked ? 'audio' : 'off')} aria-label="Enable Infinity (with audio)" />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-foreground">
              <span className="min-w-0">Enable Infinity (Text Only)</span>
              <Switch checked={infinityChatMode === 'text'} onCheckedChange={(checked) => onInfinityChatModeChange?.(checked ? 'text' : 'off')} aria-label="Enable Infinity (Text Only)" />
            </label>
          </div>

          <h3 className="mb-2 mt-6 text-sm font-semibold text-foreground">History</h3>
          {historyCoins.length === 0 ? (
            <p className="text-xs text-foreground/50">
              No saved chats yet. Send a message in chat, then use Save History to seal the transcript into one of your mined coins.
            </p>
          ) : (
            <div className="space-y-1.5">
              {historyCoins.slice(0, 5).map((coin) => (
                <button
                  key={coin.coinId}
                  type="button"
                  onClick={() => { setViewingCoin(coin); }}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2 text-left text-xs transition-colors hover:bg-white/5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground/90">
                      {coin.wrappedChat!.participants.slice(0, 3).join(', ')}{coin.wrappedChat!.participants.length > 3 ? '…' : ''}
                    </span>
                    <span className="block text-[10px] text-foreground/50">
                      {new Date(coin.wrappedChat!.savedAt).toLocaleString()} · {coin.wrappedChat!.messageCount} messages
                    </span>
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">coin …{coin.coinId.slice(-6)}</Badge>
                </button>
              ))}
              {historyCoins.length > 5 && (
                <a href="/wallet" className="block pt-1 text-[11px] text-primary/70 hover:text-primary">
                  View all {historyCoins.length} saved chat coins in your wallet →
                </a>
              )}
            </div>
          )}
        </TabsContent>
      )}
    </Tabs>
  );
}