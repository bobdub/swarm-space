import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import { clearBrainSync } from '@/lib/brain/brainSyncStore';

interface Props {
  roomId: string;
  peerCount: number;
  isMuted: boolean;
  toggleMute: () => void;
}

export function BrainSyncDock({ peerCount, isMuted, toggleMute }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const manager = user ? getWebRTCManager(user.id, user.username) : null;
  const [cameraOn, setCameraOn] = useState(() => manager?.isCameraOn() ?? false);

  const toggleCamera = async () => {
    if (!manager) return;
    if (!cameraOn) {
      try {
        await manager.startLocalStream(true, true);
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
    try { manager.toggleVideo(false); } catch { /* ignore */ }
    void manager.leaveRoom();
    manager.stopLocalStream();
  };

  return (
    <div
      role="region"
      aria-label="Brain synced"
      className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1 shadow-lg backdrop-blur"
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
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={toggleMute} aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}>
        {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={toggleCamera} aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}>
        {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
      </Button>
      <Button type="button" size="icon" variant="destructive" className="h-8 w-8 rounded-full" onClick={disconnect} aria-label="Disconnect from the Brain">
        <PhoneOff className="h-4 w-4" />
      </Button>
    </div>
  );
}
