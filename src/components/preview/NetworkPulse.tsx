/**
 * NetworkPulse
 *
 * Live network stats strip shown on the preview page. Proves the mesh
 * is alive even before the guest signs up — active peers, peers hosting
 * the requested content, and a soft CTA to join.
 */

import { useEffect, useState } from 'react';
import { Users, Radio, Sparkles } from 'lucide-react';
import { useP2PContext } from '@/contexts/P2PContext';
import { requestContentHost } from '@/lib/p2p/contentLookup';

interface Props {
  postId?: string;
  onJoin?: () => void;
}

export function NetworkPulse({ postId, onJoin }: Props) {
  const p2p = useP2PContext();
  const [peerCount, setPeerCount] = useState(0);
  const [hostCount, setHostCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const peers = p2p.getActivePeerConnections?.() ?? [];
        if (!cancelled) setPeerCount(peers.length);
      } catch { /* ignore */ }

      if (postId) {
        const acks = await requestContentHost(postId, { timeoutMs: 2500 });
        if (!cancelled) setHostCount(acks.length);
      }
    };

    tick();
    const interval = window.setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [p2p, postId]);

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
        <Users className="h-3.5 w-3.5 text-primary" />
        <span className="tabular-nums font-medium">{peerCount}</span>
        <span className="text-muted-foreground">peers online</span>
      </span>
      {postId && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/10 border border-secondary/20">
          <Radio className="h-3.5 w-3.5 text-secondary" />
          <span className="tabular-nums font-medium">{hostCount}</span>
          <span className="text-muted-foreground">hosting this</span>
        </span>
      )}
      {onJoin && (
        <button
          type="button"
          onClick={onJoin}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-primary/20 to-secondary/20 border border-primary/30 hover:from-primary/30 hover:to-secondary/30 transition"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="font-medium">Join to help share</span>
        </button>
      )}
    </div>
  );
}