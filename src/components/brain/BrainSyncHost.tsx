/**
 * Keeps the user in their Brain conversation on every page other than the
 * Brain itself, and shows the small "Brain synced" bar there.
 */
import { useLocation } from 'react-router-dom';
import { useBrainSyncRoom } from '@/lib/brain/brainSyncStore';
import { useLiveRoomBinding } from '@/lib/streaming/spectatedLiveRoomStore';
import { useBrainVoice } from '@/hooks/useBrainVoice';
import { BrainSyncDock } from './BrainSyncDock';

function BrainSyncBinding({ roomId }: { roomId: string }) {
  const voice = useBrainVoice(true, roomId);
  return <BrainSyncDock roomId={roomId} peerCount={voice.participants.length} isMuted={voice.isMuted} toggleMute={voice.toggleMute} />;
}

export function BrainSyncHost(): JSX.Element | null {
  const roomId = useBrainSyncRoom();
  const { pathname } = useLocation();
  const { roomId: liveRoomId } = useLiveRoomBinding();
  if (!roomId) return null;
  // The Brain page (and project universes) run their own binding.
  if (pathname.startsWith('/brain') || pathname.includes('/universe')) return null;
  if (liveRoomId && liveRoomId !== roomId) return null;
  return <BrainSyncBinding roomId={roomId} />;
}

export default BrainSyncHost;
