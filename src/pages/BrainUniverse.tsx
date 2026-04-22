/**
 * BrainUniverse — global Brain universe page. Thin wrapper around the
 * shared `BrainUniverseScene` so /brain and /projects/:id/hub render the
 * exact same world with different room ids and persistence buckets.
 */
import BrainUniverseScene from '@/components/brain/BrainUniverseScene';
import { BRAIN_ROOM_ID } from '@/hooks/useBrainVoice';
import { useNavigate } from 'react-router-dom';

export default function BrainUniverse() {
  const navigate = useNavigate();
  return (
    <BrainUniverseScene
      roomId={BRAIN_ROOM_ID}
      universeKey="global"
      leaveLabel="Leave"
      onLeave={() => navigate('/explore')}
    />
  );
}