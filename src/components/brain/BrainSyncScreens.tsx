/**
 * Screen shares for a Brain-synced user on any page other than the Brain.
 * Viewers keep watching a peer's share after they leave the Brain page; the
 * host sees a "Stop sharing" control so the share can be ended from anywhere.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Maximize2, Minimize2, MonitorUp, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getWebRTCManager } from '@/lib/webrtc/manager';
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
    const poll = window.setInterval(refresh, 1500);
    return () => { unsub(); window.clearInterval(poll); };
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
}

/** Floating viewer for peers' screen shares while Brain-synced off the Brain page. */
export function BrainSyncScreens({ remote, nameByPeerId }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  // A share that ended (or a new share from someone hidden earlier) resets.
  useEffect(() => {
    setHidden((prev) => {
      const live = new Set(remote.map((r) => r.peerId));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [remote]);

  const visible = remote.filter((r) => !hidden.has(r.peerId));
  const active = visible.find((r) => r.peerId === activeId) ?? visible[0] ?? null;
  if (!active) return null;

  const label = `${nameByPeerId[active.peerId] ?? active.peerId.slice(0, 8)}'s screen`;
  const close = () => {
    setHidden((prev) => new Set(prev).add(active.peerId));
    setExpanded(false);
  };

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 text-xs font-medium shadow-lg backdrop-blur hover:bg-muted"
        aria-label={`Show ${label}`}
      >
        <MonitorUp className="h-4 w-4 text-primary" />
        <span className="max-w-[12rem] truncate">{label}</span>
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label="Brain screen share"
      className={cn(
        'fixed z-40 flex flex-col overflow-hidden border border-border bg-card/95 shadow-xl backdrop-blur',
        expanded
          ? 'inset-4 rounded-lg'
          : 'bottom-4 right-4 w-[min(22rem,calc(100vw-2rem))] rounded-lg',
      )}
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-1 text-xs">
        <MonitorUp className="h-3.5 w-3.5 shrink-0 text-primary" />
        {visible.length > 1 ? (
          <select
            value={active.peerId}
            onChange={(e) => setActiveId(e.target.value)}
            className="min-w-0 flex-1 truncate bg-transparent"
            aria-label="Choose a screen share"
          >
            {visible.map((r) => (
              <option key={r.peerId} value={r.peerId}>
                {`${nameByPeerId[r.peerId] ?? r.peerId.slice(0, 8)}'s screen`}
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        )}
        <button type="button" onClick={() => setExpanded((v) => !v)} className="rounded p-1 hover:bg-muted" aria-label={expanded ? 'Shrink screen share' : 'Watch full size'}>
          {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        {!expanded && (
          <button type="button" onClick={() => setMinimized(true)} className="rounded p-1 hover:bg-muted" aria-label="Minimize screen share">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
        <button type="button" onClick={close} className="rounded p-1 hover:bg-muted" aria-label="Close screen share">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <TileVideo
        stream={active.stream}
        muted
        className={cn('block w-full bg-black object-contain', expanded ? 'min-h-0 flex-1' : 'aspect-video')}
      />
    </div>
  );
}
