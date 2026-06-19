import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Brain, ExternalLink, LayoutGrid, LogOut, Maximize2, Mic, MicOff, Minimize2, Radio, Video, VideoOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BrainChatPanel, type BrainChatLine } from '@/components/brain/BrainChatPanel';
import BrainUniverseScene from '@/components/brain/BrainUniverseScene';
import { liveChatVariant } from '@/lib/brain/variants';
import { useStreaming } from '@/hooks/useStreaming';
import { useAuth } from '@/hooks/useAuth';
import { useP2PContext } from '@/contexts/P2PContext';
import { useBrainVoice } from '@/hooks/useBrainVoice';
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

  const [chatLines, setChatLines] = useState<BrainChatLine[]>([]);
  const [rtcParticipants, setRtcParticipants] = useState<VideoParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [immersiveOpen, setImmersiveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [viewMode, setViewMode] = useState<'classic' | 'brain'>('classic');
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const { participants: voicePeers, isMuted, toggleMute, sendChatLine, onChatLine } =
    useBrainVoice(true, roomId);

  useEffect(() => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const refresh = () => setRtcParticipants(manager.getParticipants());
    refresh();
    const unsub = manager.onMessage((m) => {
      if (m.type === 'peer-joined' || m.type === 'peer-left' || m.type === 'room-updated') {
        refresh();
      }
    });
    const poll = window.setInterval(refresh, 1500);
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

  const handleSend = useCallback((text: string, replyTo?: BrainChatLine['replyTo']) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const author = user?.displayName || user?.username || 'You';
    setChatLines((prev) => [...prev, {
      id, author, text, ts: Date.now(), authorId: user?.id, replyTo,
    }]);
    try { sendChatLine(text, id); } catch { /* ignore */ }
  }, [sendChatLine, user]);

  const toggleCamera = useCallback(async () => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    try {
      if (cameraOn) {
        manager.toggleVideo(false);
        setCameraOn(false);
        setLocalStream(manager.getLocalStream?.() ?? null);
      } else {
        const stream = await manager.startLocalStream(true, true).catch((err) => {
          console.warn('[LivePostBox] camera request denied', err);
          toast.error('Camera access denied — staying as viewer.');
          return null;
        });
        if (stream) { setLocalStream(stream); setCameraOn(true); }
      }
    } catch (err) {
      console.warn('[LivePostBox] toggleCamera failed', err);
    }
  }, [cameraOn, user]);

  const handleMicToggle = useCallback(async () => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const existing = manager.getLocalStream?.();
    const hasAudioTrack = Boolean(existing?.getAudioTracks().length);
    if (!hasAudioTrack) {
      const stream = await manager.startLocalStream(true, cameraOn).catch((err) => {
        console.warn('[LivePostBox] mic request denied', err);
        toast.error('Microphone access denied — staying as viewer.');
        return null;
      });
      if (stream) {
        setLocalStream(stream);
        if (isMuted) toggleMute();
      }
      return;
    }
    toggleMute();
  }, [cameraOn, isMuted, toggleMute, user]);

  const localPeerId = (() => { try { return getPeerId?.() ?? null; } catch { return null; } })();
  const isHost = Boolean(localPeerId && room.hostPeerId === localPeerId);

  const handleLeave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await leaveRoom(roomId);
      setFloatingLiveDock(null);
      toast.success('Left live room');
    } catch (err) {
      console.warn('[LivePostBox] leaveRoom failed', err);
    } finally {
      setLeaving(false);
    }
  }, [leaveRoom, roomId, leaving]);

  const handleEndLive = useCallback(async () => {
    if (!isHost) return;
    try {
      await setRoomBroadcastState(roomId, 'ended');
      setFloatingLiveDock(null);
      toast.success('Live ended');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to end live');
    }
  }, [isHost, roomId, setRoomBroadcastState]);

  const liveVariant = useMemo(() => liveChatVariant({
    room: { id: roomId, title: displayTitle, projectId: room.projectId ?? null },
    onLeave: () => setImmersiveOpen(false),
  }), [roomId, displayTitle, room.projectId]);

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

  const participantCount = rtcParticipants.length + 1; // include self

  return (
    <div role="form" aria-label="Live stream room" className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground/60">
        <Badge variant="destructive" className="gap-1">
          <Radio className="h-3 w-3 animate-pulse" /> Live
        </Badge>
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
        {/* Brain preview pane — flows in normal layout so nothing escapes the post box */}
        <div className="relative w-full overflow-hidden bg-gradient-to-br from-[hsl(265,70%,12%)] via-[hsl(245,70%,8%)] to-[hsl(200,70%,10%)]">
          <div className="pointer-events-none absolute inset-0 opacity-60">
            <div className="absolute left-1/2 top-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,hsla(180,80%,60%,0.18),transparent_60%)]" />
            <div className="absolute left-1/3 top-1/2 h-[60%] w-[60%] -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,hsla(326,71%,62%,0.12),transparent_70%)]" />
            <div className="absolute right-1/4 bottom-1/4 h-[40%] w-[40%] rounded-full bg-[radial-gradient(circle_at_center,hsla(265,70%,55%,0.18),transparent_70%)]" />
          </div>
          <div className="relative z-10 flex flex-col items-center justify-center gap-1.5 p-3 text-center">
            <Badge variant="outline" className="border-primary/40 bg-black/40 text-[10px] text-primary">
              Brain area · live preview
            </Badge>
            <h3 className="line-clamp-1 text-sm font-semibold text-foreground drop-shadow sm:text-base">{displayTitle}</h3>
            <p className="line-clamp-1 text-[11px] text-foreground/60">
              Watching from the post. A/V stays smooth.
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-1 h-8 gap-2 px-3 text-xs"
              onClick={() => setImmersiveOpen(true)}
            >
              <Maximize2 className="h-3.5 w-3.5" /> Join Live Brain
            </Button>

            {tiles.length > 0 && (
              <div className="mt-2 flex w-full flex-wrap items-center justify-center gap-2">
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
                      muted={t.isSelf}
                      className={cn('block bg-black object-cover', 'h-[72px] w-[96px] sm:h-[88px] sm:w-[120px]')}
                    />
                    <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-[10px] text-white">
                      {t.muted ? <MicOff className="h-3 w-3 text-red-400" /> : <Mic className="h-3 w-3 text-emerald-400" />}
                      <span className="truncate">{t.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Classic controls */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[hsla(180,80%,60%,0.18)] bg-black/30 p-2">
          <Button
            type="button"
            size="sm"
            variant={isMuted ? 'outline' : 'secondary'}
            onClick={handleMicToggle}
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
        <div className="min-h-[200px] flex-1 border-t border-[hsla(180,80%,60%,0.18)] bg-black/20 p-2">
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