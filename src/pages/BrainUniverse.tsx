/**
 * BrainUniverse — global Brain (`/brain`). Thin wrapper that builds a
 * `lobbyVariant` for the shared `BrainUniverseScene`. When a live room is
 * active we bind to it so chat + Promote reference the user's broadcast.
 */
import { useNavigate } from 'react-router-dom';
import BrainUniverseScene from '@/components/brain/BrainUniverseScene';
import { useStreaming } from '@/hooks/useStreaming';
import { lobbyVariant } from '@/lib/brain/variants';

export default function BrainUniverse() {
  const navigate = useNavigate();
  const { activeRoom } = useStreaming();
  const variant = lobbyVariant({
    onLeave: () => navigate('/explore'),
    activeRoomId: activeRoom?.id,
  });
  return <BrainUniverseScene variant={variant} />;
}