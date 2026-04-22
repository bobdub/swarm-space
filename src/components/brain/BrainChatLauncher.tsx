import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStreaming } from '@/hooks/useStreaming';

/**
 * Global "Enter Brain" launcher — replaces the legacy Live Chat tray.
 * Navigates to the full Brain universe (3D scene + voice + video + chat
 * + presence). Hidden on routes that already host the scene inline. If a
 * live room is active, deep-links into the project hub for that room
 * when possible; otherwise opens the global Brain at /brain.
 */
export function BrainChatLauncher(): JSX.Element | null {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeRoom } = useStreaming();

  // Hide on routes that already host the Brain scene inline.
  const path = location.pathname;
  const isBrainScene = path === '/brain' || /^\/projects\/[^/]+\/hub$/.test(path);

  const liveBadge = useMemo(() => Boolean(activeRoom), [activeRoom]);

  // Live rooms tied to a project hub deep-link there; everything else
  // (including ad-hoc live rooms) opens the global Brain so users land
  // in a full universe with voice + video + chat + avatars.
  const targetPath = useMemo(() => {
    const id = activeRoom?.id ?? '';
    const projectMatch = /^brain-project-([^/]+)$/.exec(id);
    if (projectMatch) return `/projects/${projectMatch[1]}/hub`;
    return '/brain';
  }, [activeRoom]);

  const handleEnter = useCallback(() => {
    navigate(targetPath);
  }, [navigate, targetPath]);

  if (isBrainScene) return null;

  return (
    <Button
      type="button"
      onClick={handleEnter}
      className="fixed bottom-20 right-4 z-50 h-12 gap-2 rounded-full px-4 shadow-xl md:bottom-4"
      aria-label="Enter Brain universe"
    >
      <Sparkles className="h-4 w-4" />
      <span className="hidden sm:inline">Enter Brain</span>
      {liveBadge && (
        <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">LIVE</Badge>
      )}
    </Button>
  );
}

export default BrainChatLauncher;