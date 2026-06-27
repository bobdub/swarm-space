import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Eye, MessageSquare, Mic, MicOff, Minimize2, Radio, Users, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import BrainUniverseScene from '@/components/brain/BrainUniverseScene';
import { liveChatVariant } from '@/lib/brain/variants';
import { useAuth } from '@/hooks/useAuth';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import type { VideoParticipant } from '@/lib/webrtc/types';
import { useActiveSpeaker } from '@/hooks/useActiveSpeaker';
import { getRoomChatMessages, helloRoom, onRoomChatMessage } from '@/lib/streaming/webrtcSignalingBridge.standalone';
import type { StreamRoom } from '@/types/streaming';
import { setFloatingLiveDock } from '@/lib/streaming/floatingLiveDockStore';
import { cn } from '@/lib/utils';
import { BrainPreviewBackdrop } from './BrainPreviewBackdrop';

interface LivePostPreviewProps {
  room: StreamRoom;
  title?: string;
  visibility?: string;
  onPopOut: () => void;
  /** When true the floating dock is currently showing this room. The
   *  preview swaps "Open chat" for a "Dock back" control so the user
   *  can collapse the floating window from the inline post. */
  isPoppedOut?: boolean;
  /** Escalates from passive spectator into the room participant/pre-join flow. */
  onJoin?: () => void;
  canJoin?: boolean;
  isJoining?: boolean;
}

type PreviewChatLine = { id: string; author: string; text: string; ts: number };

function hasLiveTrack(stream: MediaStream | null | undefined, kind: 'audio' | 'video'): boolean {
  if (!stream) return false;
  const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
  return tracks.some((track) => track.readyState === 'live' && track.enabled);
}

/**
 * Inline spectator surface for a live-stream feed post. Non-participants
 * receive room media/chat over the mesh without entering the stage roster;
 * mic/camera toggles escalate only when the viewer chooses to speak.
 */
export function LivePostPreview({
  room,
  title,
  visibility,
  onPopOut,
  isPoppedOut = false,
  onJoin,
  canJoin = true,
  isJoining = false,
}: LivePostPreviewProps): JSX.Element {
  const { user } = useAuth();
  const displayTitle = (room.title || title || 'Live room').trim();
  const [rtcParticipants, setRtcParticipants] = useState<VideoParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [previewConnected, setPreviewConnected] = useState(false);
  const [listenMuted, setListenMuted] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [viewMode, setViewMode] = useState<'classic' | 'brain'>('classic');
  const [chatLines, setChatLines] = useState<PreviewChatLine[]>([]);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  const participantCount = useMemo(() => {
    // StreamRoom.participants is the authoritative server count when present.
    const arr = (room as { participants?: Array<unknown> }).participants;
    return Array.isArray(arr) ? arr.length : 0;
  }, [room]);

  const liveVariant = useMemo(() => liveChatVariant({
    room: { id: room.id, title: displayTitle, projectId: room.projectId ?? null },
    onLeave: () => setViewMode('classic'),
  }), [room.id, displayTitle, room.projectId]);

  const refreshMediaState = useCallback(() => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const nextLocal = manager.getLocalStream?.() ?? null;
    setRtcParticipants(manager.getParticipants());
    setLocalStream(nextLocal);
    setMicOn(hasLiveTrack(nextLocal, 'audio'));
    setCameraOn(hasLiveTrack(nextLocal, 'video'));
  }, [user]);

  const playRemoteAudio = useCallback(() => {
    if (listenMuted) return;
    for (const audio of audioRefs.current.values()) {
      void audio.play().catch(() => undefined);
    }
  }, [listenMuted]);

  // Passive spectator sync: connect to the WebRTC room with no mic/camera
  // and without adding this viewer to the streaming participant roster.
  useEffect(() => {
    if (!user || room.state === 'ended') return;
    const manager = getWebRTCManager(user.id, user.username);
    let cancelled = false;
    const refresh = () => {
      if (cancelled) return;
      refreshMediaState();
    };

    void manager.joinRoom(room.id).then((ok) => {
      if (cancelled) return;
      setPreviewConnected(Boolean(ok));
      refresh();
      try { helloRoom(room.id); } catch { /* ignore */ }
      window.setTimeout(() => {
        if (!cancelled) {
          try { helloRoom(room.id); } catch { /* ignore */ }
        }
      }, 1200);
    }).catch((error) => {
      console.warn('[LivePostPreview] spectator sync failed', error);
      setPreviewConnected(false);
    });

    const unsubscribe = manager.onMessage((message) => {
      if (message.roomId && message.roomId !== room.id) return;
      refresh();
    });
    const poll = window.setInterval(refresh, 1500);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [refreshMediaState, room.id, room.state, user]);

  useEffect(() => {
    try {
      const seeded = getRoomChatMessages(room.id).slice(-4).map((message) => ({
        id: message.id,
        author: message.senderUsername || message.senderPeerId.slice(0, 8),
        text: message.text.includes('\u0001') ? message.text.split('\u0001').slice(1).join('\u0001') : message.text,
        ts: message.ts,
      }));
      setChatLines(seeded);
    } catch {
      setChatLines([]);
    }
    return onRoomChatMessage((message) => {
      if (message.roomId !== room.id) return;
      const text = message.text.includes('\u0001') ? message.text.split('\u0001').slice(1).join('\u0001') : message.text;
      setChatLines((prev) => {
        if (prev.some((line) => line.id === message.id)) return prev;
        return [...prev, {
          id: message.id,
          author: message.senderUsername || message.senderPeerId.slice(0, 8),
          text,
          ts: message.ts,
        }].slice(-4);
      });
    });
  }, [room.id]);

  const videoTiles = useMemo(() => {
    const out: Array<{ key: string; label: string; stream: MediaStream; isSelf: boolean; muted: boolean }> = [];
    if (cameraOn && localStream && hasLiveTrack(localStream, 'video')) {
      out.push({ key: 'self', label: `${user?.username ?? 'You'} (you)`, stream: localStream, isSelf: true, muted: !micOn });
    }
    for (const participant of rtcParticipants) {
      if (!participant.stream || !hasLiveTrack(participant.stream, 'video')) continue;
      out.push({
        key: participant.peerId,
        label: participant.username || participant.peerId.slice(0, 8),
        stream: participant.stream,
        isSelf: false,
        muted: participant.isMuted,
      });
    }
    return out;
  }, [cameraOn, localStream, micOn, rtcParticipants, user?.username]);

  const audioParticipants = useMemo(
    () => rtcParticipants.filter((participant) => hasLiveTrack(participant.stream, 'audio')),
    [rtcParticipants],
  );

  const activeSpeaker = useActiveSpeaker(audioParticipants);
  const hostPeerId = (room as { hostPeerId?: string | null }).hostPeerId ?? null;
  const hostParticipant = hostPeerId
    ? rtcParticipants.find((p) => p.peerId === hostPeerId)
    : null;
  const hostHasAudio = hasLiveTrack(hostParticipant?.stream, 'audio') && !hostParticipant?.isMuted;
  const hostIsSpeaking = hostPeerId ? activeSpeaker === hostPeerId : false;

  useEffect(() => {
    for (const tile of videoTiles) {
      const el = videoRefs.current.get(tile.key);
      if (el && el.srcObject !== tile.stream) {
        el.srcObject = tile.stream;
      }
    }
  }, [videoTiles]);

  useEffect(() => {
    for (const participant of audioParticipants) {
      const el = audioRefs.current.get(participant.peerId);
      if (el && el.srcObject !== participant.stream) {
        el.srcObject = participant.stream;
      }
    }
    playRemoteAudio();
  }, [audioParticipants, playRemoteAudio]);

  const openChat = () => {
    onPopOut();
    setFloatingLiveDock({
      roomId: room.id,
      room,
      title: displayTitle,
      visibility,
    });
  };

  const dockBack = () => setFloatingLiveDock(null);

  const toggleListen = () => {
    setListenMuted((prev) => {
      const next = !prev;
      if (!next) window.setTimeout(playRemoteAudio, 0);
      return next;
    });
  };

  const toggleMic = async () => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    if (micOn) {
      manager.toggleAudio(false);
      setMicOn(false);
      return;
    }
    const stream = await manager.startLocalStream(true, cameraOn).catch((error) => {
      console.warn('[LivePostPreview] mic request denied', error);
      return null;
    });
    if (stream) {
      manager.toggleAudio(true);
      setLocalStream(stream);
      setMicOn(true);
      refreshMediaState();
    }
  };

  const toggleCamera = async () => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    if (cameraOn) {
      manager.toggleVideo(false);
      setCameraOn(false);
      return;
    }
    const stream = await manager.startLocalStream(micOn, true).catch((error) => {
      console.warn('[LivePostPreview] camera request denied', error);
      return null;
    });
    if (stream) {
      manager.toggleVideo(true);
      setLocalStream(stream);
      setCameraOn(true);
      refreshMediaState();
    }
  };

  return (
    <div
      role="group"
      aria-label={`Live room ${displayTitle}`}
      className="relative w-full overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
      style={{ minHeight: 260 }}
    >
      <BrainPreviewBackdrop />

      <div className="relative z-10 flex min-h-[260px] flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-foreground/60">
          <Badge variant="destructive" className="gap-1">
            <Radio className="h-3 w-3 animate-pulse" /> Live
          </Badge>
          {visibility && (
            <Badge variant="outline" className="capitalize">
              {visibility.replace('-', ' ')}
            </Badge>
          )}
          {participantCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 text-foreground/55">
              <Users className="h-3 w-3" /> {participantCount}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-foreground/55">
            <Eye className="h-3 w-3" /> {previewConnected ? 'preview synced' : 'syncing'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground drop-shadow sm:text-base">
            {displayTitle}
          </h3>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'classic' ? 'secondary' : 'ghost'}
              onClick={() => setViewMode('classic')}
              className="h-7 gap-1 px-2 text-[11px]"
              aria-pressed={viewMode === 'classic'}
            >
              <Video className="h-3.5 w-3.5" /> Live
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'brain' ? 'secondary' : 'ghost'}
              onClick={() => setViewMode('brain')}
              className="h-7 gap-1 px-2 text-[11px]"
              aria-pressed={viewMode === 'brain'}
            >
              <Brain className="h-3.5 w-3.5" /> Brain
            </Button>
          </div>
        </div>

        <div className="grid min-h-[128px] flex-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(150px,0.38fr)]">
          <div className="relative min-h-[128px] overflow-hidden rounded-lg border border-border bg-background/70">
            {viewMode === 'brain' ? (
              <div className="absolute inset-0">
                <BrainUniverseScene variant={liveVariant} />
              </div>
            ) : videoTiles.length > 0 ? (
              <div className="grid h-full min-h-[128px] grid-cols-1 gap-1.5 p-1.5 sm:grid-cols-2">
                {videoTiles.slice(0, 4).map((tile) => (
                  <div key={tile.key} className="relative min-h-[90px] overflow-hidden rounded-md bg-background">
                    <video
                      ref={(el) => {
                        if (el) videoRefs.current.set(tile.key, el);
                        else videoRefs.current.delete(tile.key);
                      }}
                      autoPlay
                      playsInline
                      muted
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 bg-background/80 px-1.5 py-1 text-[10px] text-foreground">
                      {tile.muted ? <MicOff className="h-3 w-3 text-destructive" /> : <Mic className="h-3 w-3 text-primary" />}
                      <span className="truncate">{tile.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-[128px] flex-col items-center justify-center gap-2 p-3 text-center">
                <Radio className="h-8 w-8 animate-pulse text-primary" />
                <p className="text-xs text-foreground/65">
                  Live audio/video preview is syncing from the room.
                </p>
                {audioParticipants.length > 0 && (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <Volume2 className="h-3 w-3" /> Audio live
                  </Badge>
                )}
              </div>
            )}
          </div>

          <div className="flex min-h-[128px] flex-col rounded-lg border border-border bg-background/55 p-2">
            <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-foreground/50">
              <span>Chat</span>
              <span>{audioParticipants.length} audio</span>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
              {chatLines.length > 0 ? chatLines.map((line) => (
                <p key={line.id} className="line-clamp-2 text-[11px] leading-snug text-foreground/75">
                  <span className="font-medium text-foreground">{line.author}: </span>{line.text}
                </p>
              )) : (
                <p className="text-[11px] text-foreground/50">Listening for live chat…</p>
              )}
            </div>
          </div>
        </div>

        <div aria-hidden className="sr-only">
          {audioParticipants.map((participant) => (
            <audio
              key={`live-preview-audio-${participant.peerId}`}
              ref={(el) => {
                if (el) audioRefs.current.set(participant.peerId, el);
                else audioRefs.current.delete(participant.peerId);
              }}
              autoPlay
              muted={listenMuted}
            />
          ))}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={listenMuted ? 'outline' : 'secondary'}
            onClick={toggleListen}
            className="h-8 gap-1.5 px-3 text-xs"
            aria-label={listenMuted ? 'Unmute live preview audio' : 'Mute live preview audio'}
          >
            {listenMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            {listenMuted ? 'Muted' : 'Listening'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={micOn ? 'secondary' : 'outline'}
            onClick={toggleMic}
            className="h-8 gap-1.5 px-3 text-xs"
            aria-label={micOn ? 'Turn microphone off' : 'Turn microphone on'}
          >
            {micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
            {micOn ? 'Mic on' : 'Mic off'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={cameraOn ? 'secondary' : 'outline'}
            onClick={toggleCamera}
            className="h-8 gap-1.5 px-3 text-xs"
            aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          >
            {cameraOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
            {cameraOn ? 'Cam on' : 'Cam off'}
          </Button>
          {isPoppedOut ? (
            <Button
              type="button"
              size="sm"
              onClick={dockBack}
              className="h-8 gap-1.5 px-3 text-xs"
              aria-label="Dock floating live window back into post"
            >
              <Minimize2 className="h-3.5 w-3.5" /> Dock back
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={openChat}
              className="h-8 gap-1.5 px-3 text-xs"
              aria-label="Open live chat in floating window"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Open chat
            </Button>
          )}
          {onJoin && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onJoin}
              disabled={!canJoin || isJoining}
              className={cn('h-8 gap-1.5 px-3 text-xs', !canJoin && 'opacity-60')}
              aria-label="Join live room as a participant"
            >
              <Radio className="h-3.5 w-3.5" /> {isJoining ? 'Joining…' : 'Join stage'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default LivePostPreview;