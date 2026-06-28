import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Brain, ExternalLink, LayoutGrid, LogOut, Maximize2, Mic, MicOff, Minimize2, Radio, RefreshCw, Video, VideoOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BrainChatPanel, type BrainChatLine } from '@/components/brain/BrainChatPanel';
import BrainUniverseScene from '@/components/brain/BrainUniverseScene';
import { liveChatVariant } from '@/lib/brain/variants';
import { useStreaming } from '@/hooks/useStreaming';
import { useAuth } from '@/hooks/useAuth';
import { useP2PContext } from '@/contexts/P2PContext';
import { useBrainVoice, type BrainVoicePeer } from '@/hooks/useBrainVoice';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import type { VideoParticipant } from '@/lib/webrtc/types';
import type { StreamRoom } from '@/types/streaming';
import { applyLiveAvPriority } from '@/lib/streaming/avPriority';
import { registerLivePostBox } from '@/lib/streaming/livePostBoxRegistry';
import { setFloatingLiveDock } from '@/lib/streaming/floatingLiveDockStore';
import { cn } from '@/lib/utils';

interface LivePostBoxBodyProps {
  room: StreamRoom;
  title?: string;
  visibility?: string;
  /** When true, render a compact "Pop in" control instead of "Pop out". */
  floating?: boolean;
  /** Called when user requests to re-dock the floating window. */
  onDockBack?: () => void;
  /** Called when user requests to pop the body out into the floating dock. */
  onPopOut?: () => void;
}

/**
 * Shared live post box content. Hosts the brain preview tiles, classic
 * chat (no Infinity), A/V controls, and the immersive "Join Live Brain"
 * overlay. Used both inline inside a feed post card and inside the
 * app-level `FloatingLiveDock`.
 */
export function LivePostBoxBody({
  room,
  title,
  visibility,
  floating = false,
  onDockBack,
  onPopOut,
}: LivePostBoxBodyProps): JSX.Element {
  const { user } = useAuth();
  const { getPeerId } = useP2PContext();
  const { leaveRoom, setRoomBroadcastState } = useStreaming();
  const roomId = room.id;
  const displayTitle = (room.title || title || 'Live room').trim();
  const roomEnded = Boolean(
    room?.state === 'ended' || room?.broadcast?.state === 'ended' || room?.endedAt,
  );

  const [chatLines, setChatLines] = useState<BrainChatLine[]>([]);
  const [immersiveOpen, setImmersiveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [viewMode, setViewMode] = useState<'classic' | 'brain'>('classic');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [rtcParticipants, setRtcParticipants] = useState<VideoParticipant[]>([]);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Same Brain pipeline the lobby uses — just bound to this live room id.
  // `audio: true` brings the participant's mic into the room (matches the
  // lobby behaviour). Camera stays off by default; the user opts in below.
  const {
    participants: voicePeersData,
    isMuted,
    toggleMute,
    sendChatLine,
    onChatLine,
  } = useBrainVoice(!roomEnded, roomId, { audio: true });
  const micOn = !isMuted;

  // Mirror manager state into local component state so the camera tile
  // re-renders when remote streams arrive or local tracks toggle.
  useEffect(() => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const sync = () => {
      setRtcParticipants(manager.getParticipants());
      const stream = manager.getLocalStream?.() ?? null;
      setLocalStream(stream);
      setCameraOn(Boolean(stream?.getVideoTracks().some((t) => t.enabled && t.readyState === 'live')));
    };
    sync();
    const unsub = manager.onMessage(() => sync());
    const poll = window.setInterval(sync, 1500);
    return () => { unsub(); window.clearInterval(poll); };
  }, [user]);

  useEffect(() => {
    applyLiveAvPriority(user?.id, user?.username, 'live');
    return () => { applyLiveAvPriority(user?.id, user?.username, 'world'); };
  }, [user?.id, user?.username]);

  useEffect(() => registerLivePostBox(roomId), [roomId]);

  useEffect(() => {
    const unsub = onChatLine((line) => {
      setChatLines((prev) => {
        if (prev.some((p) => p.id === line.id)) return prev;
        return [...prev, {
          id: line.id,
          author: line.author,
          text: line.text,
          ts: line.ts,
          authorId: line.peerId,
        }];
      });
    });
    return unsub;
  }, [onChatLine]);

  // Chat history is seeded by the mesh bridge; new lines arrive via onChatLine.

  const handleSend = useCallback((text: string, replyTo?: BrainChatLine['replyTo']) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const author = user?.displayName || user?.username || 'You';
    setChatLines((prev) => [...prev, {
      id, author, text, ts: Date.now(), authorId: user?.id, replyTo,
    }]);
    try { sendChatLine(text, id); } catch { /* ignore */ }
  }, [sendChatLine, user]);

  const localPeerId = (() => { try { return getPeerId?.() ?? null; } catch { return null; } })();
  const isHost = Boolean(localPeerId && room.hostPeerId === localPeerId);

  const handleLeave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      if (user) {
        await getWebRTCManager(user.id, user.username).leaveRoom().catch(() => undefined);
      }
      await leaveRoom(roomId);
      setFloatingLiveDock(null);
      toast.success('Left live room');
    } catch (err) {
      console.warn('[LivePostBox] leaveRoom failed', err);
    } finally {
      setLeaving(false);
    }
  }, [leaveRoom, roomId, leaving, user]);

  const handleEndLive = useCallback(async () => {
    if (!isHost) return;
    try {
      await setRoomBroadcastState(roomId, 'ended');
      if (user) {
        await getWebRTCManager(user.id, user.username).leaveRoom().catch(() => undefined);
      }
      setFloatingLiveDock(null);
      toast.success('Live ended');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to end live');
    }
  }, [isHost, roomId, setRoomBroadcastState, user]);

  const liveVariant = useMemo(() => liveChatVariant({
    room: { id: roomId, title: displayTitle, projectId: room.projectId ?? null },
    onLeave: () => setImmersiveOpen(false),
  }), [roomId, displayTitle, room.projectId]);

  const voicePeers = useMemo<BrainVoicePeer[]>(() => voicePeersData, [voicePeersData]);

  const toggleCamera = useCallback(async () => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    if (cameraOn) {
      manager.toggleVideo(false);
      setCameraOn(false);
      return;
    }
    const stream = await manager.startLocalStream(true, true).catch((err) => {
      console.warn('[LivePostBox] camera request denied', err);
      return null;
    });
    if (stream) {
      manager.toggleVideo(true);
      setLocalStream(stream);
      setCameraOn(true);
    }
  }, [cameraOn, user]);

  // Build inline (non-overlay) video tiles so nothing is clipped or
  // positioned outside the post box.
  const tiles = useMemo(() => {
    const out: Array<{ key: string; label: string; stream: MediaStream; isSelf: boolean; muted: boolean }> = [];
    if (cameraOn && localStream && localStream.getVideoTracks().some((t) => t.enabled)) {
      out.push({ key: 'self', label: `${user?.username ?? 'You'} (you)`, stream: localStream, isSelf: true, muted: isMuted });
    }
    for (const p of rtcParticipants) {
      if (!p.stream) continue;
      const hasVideo = p.stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live');
      if (!hasVideo) continue;
      out.push({ key: p.peerId, label: p.username || p.peerId.slice(0, 8), stream: p.stream, isSelf: false, muted: p.isMuted });
    }
    return out;
  }, [cameraOn, localStream, isMuted, rtcParticipants, user?.username]);

  useEffect(() => {
    for (const t of tiles) {
      const el = videoRefs.current.get(t.key);
      if (el && el.srcObject !== t.stream) {
        el.srcObject = t.stream;
      }
    }
  }, [tiles]);

  const handleResyncTile = useCallback((peerId: string) => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    manager.resyncPeer(peerId).catch(() => {});
    toast(`Resyncing ${peerId.slice(0, 8)}…`);
  }, [user]);

  const participantCount = Math.max(rtcParticipants.length + 1, 1);

  const previewPaneClass = cn(
    'relative w-full overflow-hidden bg-gradient-to-br from-[hsl(265,70%,12%)] via-[hsl(245,70%,8%)] to-[hsl(200,70%,10%)]',
    floating ? 'h-[150px] shrink-0' : 'min-h-[180px] flex-1',
  );

  return (
    <div role="form" aria-label="Live stream room" className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground/60">
        <Badge variant="destructive" className="gap-1">
          <Radio className="h-3 w-3 animate-pulse" /> Live
        </Badge>
        {!floating && (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold normal-case tracking-normal text-foreground">
            {displayTitle}
          </span>
        )}
        {isHost && (
          <Badge variant={isMuted ? 'outline' : 'default'} className="gap-1">
            {isMuted ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3 animate-pulse" />}
            {isMuted ? 'Mic muted' : 'Broadcasting'}
          </Badge>
        )}
        {visibility && (
          <Badge variant="outline" className="capitalize">{visibility.replace('-', ' ')}</Badge>
        )}
        <span className="ml-auto text-[10px] text-foreground/50">{participantCount} in room</span>
        {floating ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => onDockBack?.()}
            aria-label="Dock window back into post"
          >
            <Minimize2 className="h-3.5 w-3.5" /> Dock
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => onPopOut?.()}
            aria-label="Pop chat out to a floating window"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Pop out
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[hsla(180,80%,60%,0.18)] bg-[hsla(245,70%,12%,0.55)] shadow-xl backdrop-blur">
        {/* View switcher: Classic tiles vs live Brain world preview */}
        <div className="flex items-center gap-1 border-b border-[hsla(180,80%,60%,0.18)] bg-black/40 p-1.5">
          <Button
            type="button"
            size="sm"
            variant={viewMode === 'classic' ? 'secondary' : 'ghost'}
            onClick={() => setViewMode('classic')}
            className="h-7 gap-1 px-2 text-[11px]"
            aria-pressed={viewMode === 'classic'}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Classic
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === 'brain' ? 'secondary' : 'ghost'}
            onClick={() => setViewMode('brain')}
            className="h-7 gap-1 px-2 text-[11px]"
            aria-pressed={viewMode === 'brain'}
          >
            <Brain className="h-3.5 w-3.5" /> Brain view
          </Button>
          <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-foreground/40">
            {viewMode === 'brain' ? 'Spectator' : 'Tiles'}
          </span>
        </div>

        {/* Preview pane — fixed aspect so it never overflows the post / dock */}
        {viewMode === 'brain' ? (
          <div className={cn('relative w-full overflow-hidden bg-black', floating ? 'h-[150px] shrink-0' : 'min-h-[180px] flex-1')}>
            <BrainUniverseScene variant={liveVariant} />
            <Button
              type="button"
              size="sm"
              className="absolute right-2 top-2 z-10 h-7 gap-1 px-2 text-[11px] shadow-lg"
              onClick={() => setImmersiveOpen(true)}
              aria-label="Enter Brain as a player"
            >
              <Maximize2 className="h-3.5 w-3.5" /> Enter
            </Button>
          </div>
        ) : (
        <div className={previewPaneClass}>
          <div className="pointer-events-none absolute inset-0 opacity-60">
            <div className="absolute left-1/2 top-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,hsla(180,80%,60%,0.18),transparent_60%)]" />
            <div className="absolute left-1/3 top-1/2 h-[60%] w-[60%] -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,hsla(326,71%,62%,0.12),transparent_70%)]" />
            <div className="absolute right-1/4 bottom-1/4 h-[40%] w-[40%] rounded-full bg-[radial-gradient(circle_at_center,hsla(265,70%,55%,0.18),transparent_70%)]" />
          </div>
          <div className="relative z-10 flex h-full flex-col items-center justify-center gap-1.5 overflow-y-auto p-3 text-center">
            {tiles.length > 0 && (
              <div className="mt-2 flex w-full flex-wrap items-center justify-center gap-2 overflow-y-auto">
                {tiles.map((t) => (
                  <div
                    key={t.key}
                    className="relative overflow-hidden rounded-md border border-[hsla(180,80%,60%,0.3)] bg-[hsla(265,70%,8%,0.85)] shadow-lg"
                  >
                    <video
                      ref={(el) => {
                        if (el) videoRefs.current.set(t.key, el);
                        else videoRefs.current.delete(t.key);
                      }}
                      autoPlay
                      playsInline
                      muted
                      className={cn('block bg-black object-cover', 'h-[64px] w-[88px] sm:h-[80px] sm:w-[112px]')}
                    />
                    <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-[10px] text-white">
                      {t.muted ? <MicOff className="h-3 w-3 text-red-400" /> : <Mic className="h-3 w-3 text-emerald-400" />}
                      <span className="truncate">{t.label}</span>
                    </div>
                    {!t.isSelf && (
                      <button
                        type="button"
                        title="Resync this stream"
                        aria-label={`Resync ${t.label}`}
                        onClick={() => handleResyncTile(t.key)}
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {tiles.length === 0 && (
              <Radio className="h-8 w-8 animate-pulse text-primary" />
            )}
          </div>
        </div>
        )}

        {/* Remote audio is rendered globally by <PersistentAudioLayer/> in App.tsx. */}

        {/* Classic controls — mic/camera on the local participant. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[hsla(180,80%,60%,0.18)] bg-black/30 p-2">
          <Button
            type="button"
            size="sm"
            variant={isMuted ? 'outline' : 'secondary'}
            onClick={toggleMute}
            className="gap-1.5"
          >
            {isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            {isMuted ? 'Mic off' : 'Mic on'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={cameraOn ? 'secondary' : 'outline'}
            onClick={toggleCamera}
            className="gap-1.5"
          >
            {cameraOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
            {cameraOn ? 'Cam on' : 'Cam off'}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleLeave}
              disabled={leaving}
              className="gap-1.5 text-foreground/70"
              aria-label="Leave live room"
            >
              <LogOut className="h-3.5 w-3.5" /> {leaving ? 'Leaving…' : 'Leave'}
            </Button>
            {isHost && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={handleEndLive}
                className="gap-1.5"
                aria-label="End live room"
              >
                <X className="h-3.5 w-3.5" /> End live
              </Button>
            )}
          </div>
        </div>

        {/* Classic chat (no Infinity) — fills remaining height */}
        <div className={cn('flex min-h-0 flex-1 flex-col border-t border-[hsla(180,80%,60%,0.18)] bg-black/20 p-2', !floating && 'min-h-[220px]')}>
          <BrainChatPanel
            lines={chatLines}
            onSend={handleSend}
            voicePeers={voicePeers}
            rtcParticipants={rtcParticipants}
            voiceOn={!isMuted}
            roomId={roomId}
            variant="embedded"
            chatMode="classic"
            variantCapabilities={{
              portals: false,
              promoteToFeed: false,
              infinityAlwaysReplies: false,
              membershipGated: false,
            }}
          />
        </div>
      </div>

      {immersiveOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[80] bg-background">
          <BrainUniverseScene variant={liveVariant} />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setImmersiveOpen(false)}
            className="fixed left-4 top-4 z-[81] gap-2 shadow-xl"
            aria-label="Leave immersive Brain — back to post"
          >
            <ArrowLeft className="h-4 w-4" /> Back to post
          </Button>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default LivePostBoxBody;