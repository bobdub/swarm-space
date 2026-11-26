import { useEffect, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { useP2PContext } from '@/contexts/P2PContext';
import {
  MANUAL_MAX_ATTEMPTS,
  clearSettledManualConnect,
  getManualConnects,
  hasActiveManualConnects,
  matchesManualTarget,
  subscribeManualConnects,
  tickManualConnects,
} from '@/lib/p2p/manualConnect';
import { getSwarmMeshStandalone } from '@/lib/p2p/swarmMesh.standalone';

/** The target is reached over the relay because its direct dial stalled (same-Wi-Fi fallback). */
function relayedTarget(peerId: string): boolean {
  try {
    return getSwarmMeshStandalone().getRelayedPeerIds().some(id => matchesManualTarget(peerId, id));
  } catch {
    return false;
  }
}

/**
 * App-wide driver for manual connects (wifi icon, Node Dashboard). Like
 * BrainInviteConnection, it lives outside any popover so a connect keeps
 * knocking after the UI that started it closes, and it reports progress in a
 * single toast per peer that follows the real connection state.
 */
export function ManualConnectionRunner() {
  const p2p = useP2PContext();
  const p2pRef = useRef(p2p);
  p2pRef.current = p2p;
  const entries = useSyncExternalStore(subscribeManualConnects, getManualConnects);
  const active = hasActiveManualConnects();

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const ctx = p2pRef.current;
      const connections = ctx.getActivePeerConnections();
      const find = (peerId: string) => connections.find(conn => matchesManualTarget(peerId, conn.peerId));
      tickManualConnects({
        isEnabled: ctx.isEnabled,
        isConnecting: ctx.isConnecting,
        enable: () => { void ctx.enable().catch(() => { /* surfaced by the node */ }); },
        selfId: ctx.getPeerId(),
        isBlocked: ctx.isPeerBlocked,
        dial: peerId => ctx.connectToPeer(peerId, { manual: true, source: 'manual-connect' }),
        isConnected: peerId => Boolean(find(peerId)) || relayedTarget(peerId),
        isNamed: peerId => {
          const detail = find(peerId);
          return Boolean(detail?.profile?.username || detail?.profile?.displayName || detail?.userId);
        },
      });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  // One toast slot per peer, updated only when the phase or attempt changes.
  const shown = useRef(new Map<string, string>());
  useEffect(() => {
    for (const entry of entries.values()) {
      const key = `${entry.phase}:${entry.attempts}`;
      if (shown.current.get(entry.peerId) === key) continue;
      shown.current.set(entry.peerId, key);
      const id = `manual-connect-${entry.peerId}`;
      const label = entry.label;
      switch (entry.phase) {
        case 'starting':
          toast.loading(`Connecting to ${label}…`, { id, description: 'Getting your node ready to dial.' });
          break;
        case 'connecting':
          toast.loading(`Connecting to ${label}…`, {
            id,
            description: entry.attempts <= 1
              ? 'Knocking now.'
              : `Retrying (try ${entry.attempts} of ${MANUAL_MAX_ATTEMPTS}).`,
          });
          break;
        case 'syncing':
          toast.loading(`Connected to ${label}${relayedTarget(entry.peerId) ? ' (relay)' : ''}, syncing…`, { id, description: undefined });
          break;
        case 'connected':
          if (relayedTarget(entry.peerId)) {
            toast.success(`Connected to ${label} (relay)`, {
              id,
              description: 'The direct link is still being tried. Chat, presence and posts go via relay meanwhile; calls need the direct link.',
            });
          } else {
            toast.success(`Connected to ${label}`, { id, description: undefined });
          }
          shown.current.delete(entry.peerId);
          clearSettledManualConnect(entry.peerId);
          break;
        case 'unavailable':
          toast.warning(`Couldn't reach ${label}`, {
            id,
            description: 'No answer after a dial and one retry. They may be offline. Try again any time.',
          });
          shown.current.delete(entry.peerId);
          clearSettledManualConnect(entry.peerId);
          break;
        default:
          break;
      }
    }
    // A cancelled connect drops its toast.
    for (const peerId of [...shown.current.keys()]) {
      if (!entries.has(peerId)) {
        shown.current.delete(peerId);
        toast.dismiss(`manual-connect-${peerId}`);
      }
    }
  }, [entries]);

  return null;
}
