import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CornerDownRight,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Send,
  Upload,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { getRoomChatMessages } from '@/lib/streaming/webrtcSignalingBridge.standalone';
import { useIsMobile } from '@/hooks/use-mobile';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface BrainChatLine {
  id: string;
  author: string;
  text: string;
  ts: number;
  /** Original peerId/userId of the sender, used for avatar lookup. */
  authorId?: string;
  avatarRef?: string;
  replyTo?: { id: string; author: string; preview: string };
}

const MAX_LEN = 8000;
const LONG_MESSAGE_THRESHOLD = 2400;

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
  /** Variant: floating panel inside Brain scene, or modal launcher. */
  variant?: 'floating' | 'modal';
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
}: Props) {
  const { user } = useAuth();
  const { activeRoom, promoteRoomToPost } = useStreaming();
  const { broadcastPost, announceContent } = useP2PContext();
  const [text, setText] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [replyTo, setReplyTo] = useState<BrainChatLine['replyTo'] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [seededLines, setSeededLines] = useState<BrainChatLine[]>([]);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isPromoted, setIsPromoted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const activeSpeaker = useActiveSpeaker(rtcParticipants);

  // ── Promote-to-feed gating ───────────────────────────────────────
  const promoteVisible = Boolean(
    activeRoom && roomId && activeRoom.id === roomId,
  );
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
      const seeded: BrainChatLine[] = history.map((m) => ({
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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [allLines]);

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
  const containerClass = fullscreen
    ? 'fixed inset-0 z-[60] flex flex-col bg-background'
    : variant === 'modal'
      ? 'fixed bottom-20 right-4 z-[55] flex flex-col rounded-2xl border border-[hsla(180,80%,60%,0.25)] bg-[hsla(265,70%,8%,0.95)] shadow-2xl backdrop-blur-xl'
      : 'absolute bottom-4 left-4 z-20 flex flex-col rounded-2xl border border-[hsla(180,80%,60%,0.25)] bg-[hsla(265,70%,8%,0.95)] shadow-2xl backdrop-blur-xl';

  const containerStyle: React.CSSProperties = fullscreen
    ? {}
    : {
        width: 'min(560px, calc(100vw - 2rem))',
        height: 'min(60vh, 520px)',
      };

  return (
    <div className={containerClass} style={containerStyle}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[hsla(180,80%,60%,0.18)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-display uppercase tracking-[0.2em] text-foreground/80">
            Brain Chat
          </span>
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Users className="h-3 w-3" /> {railUsers.length}
          </Badge>
          {voiceOn && (
            <Badge variant="outline" className="gap-1 border-primary/40 text-[10px] text-primary">
              <Mic className="h-3 w-3" /> Voice on
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {promoteVisible && (
            <Button
              type="button"
              size="sm"
              variant={isPromoted ? 'outline' : 'secondary'}
              onClick={handlePromote}
              disabled={isPromoting || isPromoted}
              className="h-7 gap-1 text-xs"
            >
              <Upload className="h-3 w-3" />
              {isPromoted ? 'Promoted' : isPromoting ? '…' : 'Promote to feed'}
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-foreground/60 hover:text-foreground"
            onClick={() => setFullscreen((v) => !v)}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Maximize'}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
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

      {/* Body: users rail + messages */}
      <div className="flex min-h-0 flex-1">
        {/* Users rail */}
        <div className="w-[140px] shrink-0 border-r border-[hsla(180,80%,60%,0.15)] bg-black/20">
          <ScrollArea className="h-full">
            <div className="space-y-1 p-2">
              {railUsers.length === 0 && (
                <p className="px-1 py-2 text-[10px] italic text-foreground/40">
                  No peers yet
                </p>
              )}
              {railUsers.map((u) => (
                <button
                  key={u.peerId}
                  type="button"
                  onClick={() => insertMention(u.username)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-white/5',
                    u.isSpeaking && 'ring-1 ring-primary',
                  )}
                  title={`@${u.username}`}
                >
                  <Avatar
                    avatarRef={u.avatarRef}
                    username={u.peerId}
                    displayName={u.username}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-foreground/90">{u.username}</p>
                    <div className="flex items-center gap-1 text-foreground/40">
                      {u.micOn ? <Mic className="h-2.5 w-2.5 text-primary" /> : <MicOff className="h-2.5 w-2.5" />}
                      {u.cameraOn ? <Video className="h-2.5 w-2.5 text-primary" /> : <VideoOff className="h-2.5 w-2.5" />}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {allLines.length === 0 ? (
            <p className="text-sm italic text-foreground/40">
              Type to perturb the field. Mention {ENTITY_DISPLAY_NAME} to call Infinity.
            </p>
          ) : (
            <div className="space-y-2">
              {allLines.map((line) => {
                const isInfinity = line.author === ENTITY_DISPLAY_NAME;
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
                          className="hidden text-foreground/40 hover:text-foreground group-hover:inline-flex"
                          title="Reply"
                        >
                          <CornerDownRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none break-words text-foreground/90 [&_a]:text-primary [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1 [&_pre]:rounded-md [&_pre]:bg-black/50 [&_pre]:p-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {display}
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
      <div className="flex gap-2 border-t border-[hsla(180,80%,60%,0.18)] p-2">
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
          placeholder={`Speak into the brain… (${MAX_LEN.toLocaleString()} chars · Shift+Enter for newline · Markdown supported)`}
          rows={2}
          maxLength={MAX_LEN}
          className="max-h-44 min-h-[44px] flex-1 resize-none text-sm"
        />
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="self-end h-9 px-3"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}