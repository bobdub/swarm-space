/**
 * Screen shares for a Brain-synced user on any page other than the Brain.
 * Viewers keep watching a peer's share after they leave the Brain page; the
 * host sees a "Stop sharing" control so the share can be ended from anywhere.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Maximize2, Minimize2, MonitorUp, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import { isPeerMuted, subscribeMutedPeers } from '@/lib/brain/mutedPeersStore';
import { TileVideo } from './BrainVideoGrid';
import { cn } from '@/lib/utils';

interface RemoteScreen {
  peerId: string;
  stream: MediaStream;
}

function hasLiveVideo(stream: MediaStream | null | undefined): stream is MediaStream {
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
}

/** Live screen shares in the current call: the user's own and every peer's. */
export function useBrainScreenShares() {
  const { user } = useAuth();
  const [own, setOwn] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<RemoteScreen[]>([]);

  useEffect(() => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const refresh = () => {
      const mine = manager.getScreenStream();
      setOwn(hasLiveVideo(mine) ? mine : null);
      const next: RemoteScreen[] = [];
      for (const p of manager.getParticipants()) {
        // Muted/blocked peers stay hidden here too, same as in the Brain.
        if (isPeerMuted(p.peerId)) continue;
        if (hasLiveVideo(p.screenStream)) next.push({ peerId: p.peerId, stream: p.screenStream });
      }
      setRemote((prev) =>
        prev.length === next.length && prev.every((r, i) => r.peerId === next[i].peerId && r.stream === next[i].stream)
          ? prev
          : next,
      );
    };
    refresh();
    const unsub = manager.onMessage((m) => {
      if (m.type === 'screen-share-started' || m.type === 'screen-share-stopped'
        || m.type === 'peer-joined' || m.type === 'peer-left' || m.type === 'room-updated') {
        refresh();
      }
    });
    // The screen track can arrive after the announcement; poll to catch it.
    const unsubMuted = subscribeMutedPeers(refresh);
    const poll = window.setInterval(refresh, 1500);
    return () => { unsub(); unsubMuted(); window.clearInterval(poll); };
  }, [user]);

  const stopOwn = () => {
    if (!user) return;
    try { getWebRTCManager(user.id, user.username).stopScreenShare(); } catch { /* ignore */ }
    setOwn(null);
  };

  return { own, remote, stopOwn };
}

interface Props {
  remote: RemoteScreen[];
  nameByPeerId: Record<string, string>;
  /** CSS `bottom` for the docked windows and pills, to clear on-screen controls. */
  dockBottom?: string;
}

/**
 * Floating viewers for peers' screen shares, in the Brain and while
 * Brain-synced on other pages. Every share gets its own window, so several
 * can be watched at once. Each window can be expanded to full size, docked
 * to a pill at the bottom of the screen, or closed.
 */
export function BrainSyncScreens({ remote, nameByPeerId, dockBottom }: Props) {
  const [docked, setDocked] = useState<Set<string>>(() => new Set());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // A share that ended forgets its state, so a new share from the same
  // person opens in a fresh window.
  useEffect(() => {
    const live = new Set(remote.map((r) => r.peerId));
    const prune = (prev: Set<string>) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    };
    setHidden(prune);
    setDocked(prune);
    setExpandedId((id) => (id && live.has(id) ? id : null));
  }, [remote]);

  const visible = remote.filter((r) => !hidden.has(r.peerId));
  if (visible.length === 0) return null;

  const labelFor = (peerId: string) => `${nameByPeerId[peerId] ?? peerId.slice(0, 8)}'s screen`;
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, on: boolean) =>
    set((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  const close = (id: string) => {
    toggle(setHidden, id, true);
    setExpandedId((cur) => (cur === id ? null : cur));
  };
  const dock = (id: string) => {
    toggle(setDocked, id, true);
    setExpandedId((cur) => (cur === id ? null : cur));
  };

  const expanded = visible.find((r) => r.peerId === expandedId) ?? null;
  const open = visible.filter((r) => !docked.has(r.peerId) && r.peerId !== expanded?.peerId);
  const pills = visible.filter((r) => docked.has(r.peerId));
  const several = visible.length > 1;

  return (
    <>
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-40 flex max-h-[calc(100dvh-8rem)] max-w-[calc(100vw-2rem)] flex-col items-end gap-2"
        style={dockBottom ? { bottom: dockBottom, maxHeight: `calc(100dvh - ${dockBottom} - 5rem)` } : undefined}
      >
        {open.length > 0 && (
          // Newest windows wrap upward; the column scrolls if they don't fit.
          <div className="pointer-events-auto flex min-h-0 flex-wrap-reverse justify-end gap-2 overflow-y-auto">
            {open.map((r) => (
              <ScreenWindow
                key={r.peerId}
                share={r}
                label={labelFor(r.peerId)}
                compact={several}
                onExpand={() => setExpandedId(r.peerId)}
                onDock={() => dock(r.peerId)}
                onClose={() => close(r.peerId)}
              />
            ))}
          </div>
        )}
        {pills.length > 0 && (
          <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
            {pills.map((r) => (
              <div
                key={r.peerId}
                className="flex items-center rounded-full border border-border bg-card/95 shadow-lg backdrop-blur"
              >
                <button
                  type="button"
                  onClick={() => toggle(setDocked, r.peerId, false)}
                  className="flex items-center gap-2 rounded-full py-2 pl-3 pr-1 text-xs font-medium hover:bg-muted"
                  aria-label={`Show ${labelFor(r.peerId)}`}
                >
                  <MonitorUp className="h-4 w-4 text-primary" />
                  <span className="max-w-[10rem] truncate">{labelFor(r.peerId)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => close(r.peerId)}
                  className="mr-1 rounded-full p-1.5 hover:bg-muted"
                  aria-label={`Close ${labelFor(r.peerId)}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {expanded && (
        <ScreenWindow
          share={expanded}
          label={labelFor(expanded.peerId)}
          expanded
          onExpand={() => setExpandedId(null)}
          onDock={() => dock(expanded.peerId)}
          onClose={() => close(expanded.peerId)}
        />
      )}
    </>
  );
}

function ScreenWindow({
  share,
  label,
  expanded = false,
  compact = false,
  onExpand,
  onDock,
  onClose,
}: {
  share: RemoteScreen;
  label: string;
  expanded?: boolean;
  /** Several windows are open: draw each a little smaller. */
  compact?: boolean;
  /** Toggles full size. */
  onExpand: () => void;
  onDock: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      className={cn(
        'flex flex-col overflow-hidden border border-border shadow-xl',
        // Full size stays opaque: a backdrop blur that large is recomputed
        // on every frame behind the video.
        expanded
          ? 'fixed inset-4 z-40 rounded-lg bg-card'
          : cn(
            'rounded-lg bg-card/95 backdrop-blur',
            compact ? 'w-[min(18rem,calc(100vw-2rem))]' : 'w-[min(22rem,calc(100vw-2rem))]',
          ),
      )}
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-1 text-xs">
        <MonitorUp className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        <button type="button" onClick={onExpand} className="rounded p-1 hover:bg-muted" aria-label={expanded ? `Shrink ${label}` : `Watch ${label} full size`}>
          {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={onDock} className="rounded p-1 hover:bg-muted" aria-label={`Dock ${label} to the bottom`} title="Dock to bottom">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted" aria-label={`Close ${label}`}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <TileVideo
        stream={share.stream}
        muted
        screenOf={share.peerId}
        screenView={expanded ? 'full' : 'preview'}
        className={cn('block w-full bg-black object-contain', expanded ? 'min-h-0 flex-1' : 'aspect-video')}
      />
    </div>
  );
}
