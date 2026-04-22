import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStreaming } from '@/hooks/useStreaming';

/**
 * Global "Live Room" launcher — only visible when the user is in an
 * active live chat. NOT a public group-chat entry. Tapping it returns
 * the user to their live room's universe (Brain scene with voice,
 * video, chat, presence, and Promote-to-feed in the panel header).
 */
export function BrainChatLauncher(): JSX.Element | null {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeRoom } = useStreaming();

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
  if (!activeRoom || isBrainScene) return null;

  const title = activeRoom.title?.trim() || 'Live room';

  return (
    <Button
      type="button"
      onClick={handleEnter}
      variant="destructive"
      className="fixed bottom-20 right-4 z-50 h-12 max-w-[16rem] gap-2 rounded-full px-4 shadow-xl md:bottom-4"
      aria-label={`Return to live room: ${title}`}
    >
      <Radio className="h-4 w-4 animate-pulse" />
      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">LIVE</Badge>
      <span className="hidden truncate sm:inline">{title}</span>
    </Button>
  );
}

export default BrainChatLauncher;