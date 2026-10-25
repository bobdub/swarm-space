import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useP2PContext } from '@/contexts/P2PContext';
import { dialBrainInviteFirst, getBrainInviteState, prepareBrainInvite, subscribeBrainInvite, updateBrainInviteConnection } from '@/lib/p2p/brainInvite';

/** Handles navigation into invites when signaling was already initialized. */
export function BrainInviteConnection() {
  const { pathname, hash } = useLocation();
  const { user, isReady } = useAuthReady();
  const { stats, isEnabled, isConnecting, enable, connectToPeer, getPeerId, isPeerBlocked, getActivePeerConnections } = useP2PContext();
  const invite = useSyncExternalStore(subscribeBrainInvite, getBrainInviteState);
  useEffect(() => { prepareBrainInvite(pathname, hash); }, [pathname, hash]);
  useEffect(() => {
    if (pathname !== '/brain/join' || !isReady || !user) return;
    if (!isEnabled) { if (!isConnecting) void enable().catch(() => updateBrainInviteConnection(false)); return; }
    const check = () => {
      // Startup consumes this first; this path only dials an unconsumed invite.
      if (!isConnecting && (stats.status === 'online' || stats.status === 'waiting')) dialBrainInviteFirst({ pathname, hash, selfId: getPeerId(), isBlocked: isPeerBlocked,
        dial: peerId => getActivePeerConnections().some(peer => peer.peerId === peerId) || connectToPeer(peerId, { manual: true, source: 'brain-invite' }) });
      const target = getBrainInviteState().peerId;
      updateBrainInviteConnection(Boolean(target && getActivePeerConnections().some(peer => peer.peerId === target)));
    };
    check();
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [pathname, hash, user, isReady, isEnabled, isConnecting, stats.status, enable, connectToPeer, getPeerId, isPeerBlocked, getActivePeerConnections, invite.startedAt]);
  return null;
}