import { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Radio, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStreaming } from '@/hooks/useStreaming';
import { useP2PContext } from '@/contexts/P2PContext';
import { useAuth } from '@/hooks/useAuth';

/**
 * Global "Live Room" launcher — only visible when the user is in an
 * active live chat. NOT a public group-chat entry. Tapping it returns
 * the user to their live room's universe (Brain scene with voice,
 * video, chat, presence, and Promote-to-feed in the panel header).
 */
export function BrainChatLauncher(): JSX.Element | null {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeRoom, promoteRoomToPost } = useStreaming();
  const { getPeerId } = useP2PContext();
  const { user } = useAuth();
  const [promoting, setPromoting] = useState(false);

  // Hide on routes that already host the Brain/live scene inline.
  const path = location.pathname;
  const isBrainScene = path === '/brain' || /^\/projects\/[^/]+\/hub$/.test(path);

  // Project-scoped live rooms route to the project's universe; everything
  // else (ad-hoc live rooms) opens the global Brain scene which is the
  // shared live universe for those participants.
  const targetPath = useMemo(() => {
    const id = activeRoom?.id ?? '';
    const projectMatch = /^brain-project-([^/]+)$/.exec(id);
    if (projectMatch) return `/projects/${projectMatch[1]}/hub`;
    return '/brain';
  }, [activeRoom]);

  const handleEnter = useCallback(() => {
    navigate(targetPath);
  }, [navigate, targetPath]);

  // Strict gate: only render when there's an active live room AND we're
  // not already inside the scene. No live room → no launcher.
  if (!user || !activeRoom || isBrainScene) return null;

  const title = activeRoom.title?.trim() || 'Live room';
  const localPeerId = (() => { try { return getPeerId?.() ?? null; } catch { return null; } })();
  const isHost = !localPeerId || activeRoom.hostPeerId === localPeerId;
  const alreadyPromoted = Boolean(activeRoom.broadcast?.postId);
  const showPromote = isHost && !alreadyPromoted;

  const handlePromote = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (promoting) return;
    setPromoting(true);
    try {
      await promoteRoomToPost(activeRoom.id);
      toast.success('Live room promoted to feed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Promote failed');
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="fixed right-4 z-50 flex items-center gap-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4">
      {showPromote && (
        <Button
          type="button"
          onClick={handlePromote}
          variant="secondary"
          disabled={promoting}
          className="h-11 gap-1.5 rounded-full px-3 shadow-xl"
          aria-label="Promote live room to feed"
        >
          <Upload className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">{promoting ? '…' : 'Promote'}</span>
        </Button>
      )}
      <Button
        type="button"
        onClick={handleEnter}
        variant="destructive"
        className="h-11 max-w-[16rem] gap-2 rounded-full px-3 shadow-xl"
        aria-label={`Return to live room: ${title}`}
      >
        <Radio className="h-4 w-4 animate-pulse" />
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">LIVE</Badge>
        <span className="max-w-[10rem] truncate">{title}</span>
      </Button>
    </div>
  );
}

export default BrainChatLauncher;