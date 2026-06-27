import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Radio, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStreaming } from '@/hooks/useStreaming';
import { useP2PContext } from '@/contexts/P2PContext';
import { useAuth } from '@/hooks/useAuth';
import { isLivePostBoxActive, subscribeLivePostBoxes } from '@/lib/streaming/livePostBoxRegistry';
import { setFloatingLiveDock } from '@/lib/streaming/floatingLiveDockStore';

/**
 * Global "Live Room" launcher — only visible when the user is in an
 * active live chat. NOT a public group-chat entry. Tapping it returns
 * the user to their live room's universe (Brain scene with voice,
 * video, chat, presence, and Promote-to-feed in the panel header).
 */
export function BrainChatLauncher(): JSX.Element | null {
  const location = useLocation();
  const { activeRoom, promoteRoomToPost } = useStreaming();
  const { getPeerId } = useP2PContext();
  const { user } = useAuth();
  const [promoting, setPromoting] = useState(false);
  // Re-render when a LivePostBox claims/releases a room so we can hide
  // the floating launcher for rooms already owned by a feed post box.
  const [, forceTick] = useState(0);
  useEffect(() => subscribeLivePostBoxes(() => forceTick((n) => (n + 1) & 0xfff)), []);

  // Hide on routes that already host the Brain/live scene inline.
  const path = location.pathname;
  const isBrainScene = path === '/brain' || /^\/projects\/[^/]+\/hub$/.test(path);

  // Re-open the floating dock for the active live room. Brain entry
  // lives inside the dock's room menu — the launcher only restores
  // the popped-out window.
  const handleEnter = useCallback(() => {
    if (!activeRoom) return;
    setFloatingLiveDock({
      roomId: activeRoom.id,
      room: activeRoom,
      title: (activeRoom.title || 'Live room').trim(),
    });
  }, [activeRoom]);

  // Strict gate: only render when there's an active live room AND we're
  // not already inside the scene. No live room → no launcher.
  if (!user || !activeRoom || isBrainScene) return null;
  // Live-stream posts own their own return path via LivePostBox.
  if (isLivePostBoxActive(activeRoom.id)) return null;

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
        aria-label={`Re-open live room window: ${title}`}
      >
        <Radio className="h-4 w-4 animate-pulse" />
        <span className="max-w-[12rem] truncate text-xs font-semibold uppercase tracking-wider">
          Live · {title}
        </span>
      </Button>
    </div>
  );
}

export default BrainChatLauncher;