/**
 * BrainUniverse — global Brain universe page. Thin wrapper around the
 * shared `BrainUniverseScene` so /brain and /projects/:id/hub render the
 * exact same world with different room ids and persistence buckets.
 */
import BrainUniverseScene from '@/components/brain/BrainUniverseScene';
import { BRAIN_ROOM_ID } from '@/hooks/useBrainVoice';
import { useNavigate } from 'react-router-dom';
import { useStreaming } from '@/hooks/useStreaming';

export default function BrainUniverse() {
  const navigate = useNavigate();
  const { activeRoom } = useStreaming();
  // When a live room is active, bind the scene to it so chat history and
  // the Promote button reference the same room as the user's broadcast.
  const roomId = activeRoom?.id ?? BRAIN_ROOM_ID;
  return (
    <BrainUniverseScene
      roomId={roomId}
      universeKey="global"
      leaveLabel="Leave"
      onLeave={() => navigate('/explore')}
    />
  );
}