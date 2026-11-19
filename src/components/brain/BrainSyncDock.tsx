import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Brain, MonitorOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import { clearBrainSync } from '@/lib/brain/brainSyncStore';

interface Props {
  roomId: string;
  peerCount: number;
  isMuted: boolean;
  /** False when the user is listening only (no mic yet). */
  micOn?: boolean;
  toggleMute: () => void;
  /** True while this user is sharing their screen to the room. */
  isSharingScreen?: boolean;
  stopScreenShare?: () => void;
}

export function BrainSyncDock({ peerCount, isMuted, micOn = true, toggleMute, isSharingScreen = false, stopScreenShare }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const manager = user ? getWebRTCManager(user.id, user.username) : null;
  const [cameraOn, setCameraOn] = useState(() => manager?.isCameraOn() ?? false);

  const toggleCamera = async () => {
    if (!manager) return;
    if (!cameraOn) {
      try {
        await manager.startLocalStream(micOn, true);
        manager.toggleVideo(true);
        setCameraOn(true);
      } catch (err) {
        console.warn('[BrainSync] camera enable failed', err);
      }
    } else {
      manager.toggleVideo(false);
      const local = manager.getLocalStream();
      local?.getVideoTracks().forEach((t) => { t.stop(); local.removeTrack(t); });
      setCameraOn(false);
    }
  };

  const disconnect = () => {
    clearBrainSync();
    if (!manager) return;
    // Hanging up ends the host's screen share for every viewer.
    try { manager.stopScreenShare(); } catch { /* ignore */ }
    try { manager.toggleVideo(false); } catch { /* ignore */ }
    void manager.leaveRoom();
    manager.stopLocalStream();
  };

  return (
    <div
      role="region"
      aria-label="Brain synced"
      style={{ top: 'calc(var(--app-header-h, 4.5rem) + 1rem)' }}
      className="fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1 shadow-lg backdrop-blur"
    >
      <button
        type="button"
        onClick={() => navigate('/brain')}
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
        aria-label="Return to the Brain"
      >
        <Brain className="h-4 w-4 text-primary" />
        <span>Brain synced</span>
        <span className="text-muted-foreground">· {peerCount}</span>
      </button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={toggleMute} aria-label={!micOn ? 'Turn on microphone' : isMuted ? 'Unmute microphone' : 'Mute microphone'}>
        {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={toggleCamera} aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}>
        {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
      </Button>
      {isSharingScreen && stopScreenShare && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 gap-1 px-2 text-xs text-primary"
          onClick={stopScreenShare}
          aria-label="Stop sharing screen"
          title="Stop sharing screen"
        >
          <MonitorOff className="h-4 w-4" />
          <span className="hidden sm:inline">Stop sharing</span>
        </Button>
      )}
      <Button type="button" size="icon" variant="destructive" className="h-8 w-8 rounded-full" onClick={disconnect} aria-label="Disconnect from the Brain">
        <PhoneOff className="h-4 w-4" />
      </Button>
    </div>
  );
}
