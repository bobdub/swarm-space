import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, LogOut, Mic, MicOff, Radio, Video, VideoOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BrainChatPanel, type BrainChatLine } from '@/components/brain/BrainChatPanel';
import { BrainVideoGrid } from '@/components/brain/BrainVideoGrid';
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

interface LivePostBoxProps {
  room: StreamRoom;
  /** Title fallback when the room title is empty. */
  title?: string;
  /** Visibility chip (public / followers / invite-only). */
  visibility?: string;
}

/**
 * LivePostBox — the post-card surface for a live-stream post the
 * local user has joined. Shows a "brain preview" pane (participant
 * video tiles over a brain-gradient backdrop), a classic chat tab
 * (no Infinity), classic A/V controls, and a primary "Join Live
 * Brain" CTA that opens the full immersive scene as an overlay so
 * leaving the immersive view returns the user to this post box.
 *
 * Scoped strictly to live-stream posts; the lobby `/brain` and
 * project hubs are untouched.
 */
export function LivePostBox({ room, title, visibility }: LivePostBoxProps): JSX.Element {
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

  // Wire voice/presence/chat to this live room.
  const { participants: voicePeers, isMuted, toggleMute, sendChatLine, onChatLine } =
    useBrainVoice(true, roomId);

  // Track raw WebRTC participants for the video tile grid.
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

  // Bias the encoder for live: speech audio, motion video.
  useEffect(() => {
    applyLiveAvPriority(user?.id, user?.username, 'live');
    return () => { applyLiveAvPriority(user?.id, user?.username, 'world'); };
  }, [user?.id, user?.username]);

  // Register so the global BrainChatLauncher doesn't shadow this box.
  useEffect(() => registerLivePostBox(roomId), [roomId]);

  // Pipe remote chat lines into local state.
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
      id,
      author,
      text,
      ts: Date.now(),
      authorId: user?.id,
      replyTo,
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
        if (stream) {
          setLocalStream(stream);
          setCameraOn(true);
        }
      }
    } catch (err) {
      console.warn('[LivePostBox] toggleCamera failed', err);
    }
  }, [cameraOn, user]);

  // Mic toggle that doubles as a "request mic" button for viewers who
  // joined without permissions. If we have no audio track yet, attempt
  // to acquire one before falling back to the standard mute toggle.
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
        // Newly acquired stream should be live (unmuted). If it isn't,
        // ensure unmute via toggle.
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
      toast.success('Live ended');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to end live');
    }
  }, [isHost, roomId, setRoomBroadcastState]);

  const liveVariant = useMemo(() => liveChatVariant({
    room: { id: roomId, title: displayTitle, projectId: room.projectId ?? null },
    onLeave: () => setImmersiveOpen(false),
  }), [roomId, displayTitle, room.projectId]);

  const participantCount = rtcParticipants.length + 1; // include self

  return (
    <div
      role="form"
      aria-label="Live stream room"
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground/60">
        <Badge variant="destructive" className="gap-1">
          <Radio className="h-3 w-3 animate-pulse" /> Live
        </Badge>
        {visibility && (
          <Badge variant="outline" className="capitalize">{visibility.replace('-', ' ')}</Badge>
        )}
        <span className="ml-auto text-[10px] text-foreground/50">{participantCount} in room</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[hsla(180,80%,60%,0.18)] bg-[hsla(245,70%,12%,0.55)] shadow-xl backdrop-blur">
        {/* Brain preview pane */}
        <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-[hsl(265,70%,12%)] via-[hsl(245,70%,8%)] to-[hsl(200,70%,10%)]">
          {/* Decorative brain glow */}
          <div className="absolute inset-0 opacity-60">
            <div className="absolute left-1/2 top-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,hsla(180,80%,60%,0.18),transparent_60%)]" />
            <div className="absolute left-1/3 top-1/2 h-[60%] w-[60%] -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,hsla(326,71%,62%,0.12),transparent_70%)]" />
            <div className="absolute right-1/4 bottom-1/4 h-[40%] w-[40%] rounded-full bg-[radial-gradient(circle_at_center,hsla(265,70%,55%,0.18),transparent_70%)]" />
          </div>
          <div className="relative z-10 flex h-full flex-col items-center justify-center p-4 text-center">
            <Badge variant="outline" className="mb-2 border-primary/40 bg-black/40 text-[10px] text-primary">
              Brain area · live preview
            </Badge>
            <h3 className="text-lg font-semibold text-foreground drop-shadow">{displayTitle}</h3>
            <p className="mt-1 text-xs text-foreground/60">
              Watching from the post. A/V stays smooth while you decide to step in.
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-4 gap-2"
              onClick={() => setImmersiveOpen(true)}
            >
              <Radio className="h-3.5 w-3.5" /> Join Live Brain
            </Button>
          </div>
          {/* Floating video tiles */}
          <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center">
            <div className="pointer-events-auto max-w-full overflow-x-auto px-2">
              <BrainVideoGrid
                participants={rtcParticipants}
                localStream={localStream}
                localUsername={user?.username ?? 'You'}
                localMuted={isMuted}
                cameraOn={cameraOn}
              />
            </div>
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

        {/* Classic chat (no Infinity) */}
        <div className="h-[320px] border-t border-[hsla(180,80%,60%,0.18)] bg-black/20 p-2">
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

      {/* Immersive overlay — full brain scene mounted above the post box.
          Same roomId, so WebRTC tracks are preserved when toggling. */}
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

export default LivePostBox;