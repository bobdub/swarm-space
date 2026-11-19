import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useP2PContext } from '@/contexts/P2PContext';
import { dialBrainInviteFirst, resolveInviteLocation, getBrainInviteState, markBrainInviteSynced, prepareBrainInvite, subscribeBrainInvite, updateBrainInviteConnection } from '@/lib/p2p/brainInvite';
import { isGuestUser } from '@/lib/preview/guestAccess';
import { useNetworkChatOpen } from '@/lib/chat/networkChatStore';

let guestBrainAutoStarted = false;

/** Handles navigation into invites when signaling was already initialized. */
export function BrainInviteConnection() {
  const { pathname, hash } = useLocation();
  const { user, isReady } = useAuthReady();
  const { stats, isEnabled, isConnecting, enable, connectToPeer, getPeerId, isPeerBlocked, getActivePeerConnections } = useP2PContext();
  const invite = useSyncExternalStore(subscribeBrainInvite, getBrainInviteState);
  useEffect(() => { prepareBrainInvite(pathname, hash); }, [pathname, hash]);
  // A guest who enters the Brain directly (not through an invite) has a
  // guest identity but no running node, so the invite link they share would
  // point at a peer that is offline. Bring their node online in the Brain
  // or when they open the network chat.
  const isGuest = isGuestUser(user);
  const inBrain = pathname === '/brain' || pathname.startsWith('/brain/');
  // Opening Chat from the main menu needs a running node just as much: the
  // network chat reaches connected peers wherever each of them is.
  const chatOpen = useNetworkChatOpen();
  const wantsNode = inBrain || chatOpen;
  // Only once per page load: if the guest later turns networking off, that
  // choice stands until they reload.
  useEffect(() => {
    if (guestBrainAutoStarted || !isReady || !isGuest || !wantsNode || isEnabled || isConnecting) return;
    guestBrainAutoStarted = true;
    void enable().catch(() => { guestBrainAutoStarted = false; });
  }, [isReady, isGuest, wantsNode, isEnabled, isConnecting, enable]);
  useEffect(() => {
    // Until auth/guest identity resolves, the invite stays buffered in its
    // "starting" phase; this effect re-runs as soon as `user` appears.
    if (!resolveInviteLocation(pathname, hash) || !isReady || !user) return;
    if (!isEnabled) { if (!isConnecting) void enable().catch(() => updateBrainInviteConnection(false)); return; }
    const check = () => {
      // Startup consumes this first; this path only dials an unconsumed invite.
      // While the mesh is still connecting, the dial is queued until online.
      if (!isConnecting && (stats.status === 'online' || stats.status === 'waiting' || stats.status === 'connecting')) dialBrainInviteFirst({ pathname, hash, selfId: getPeerId(), isBlocked: isPeerBlocked,
        dial: peerId => getActivePeerConnections().some(peer => peer.peerId === peerId) || connectToPeer(peerId, { manual: true, source: 'brain-invite' }) });
      const target = getBrainInviteState().peerId;
      const detail = target ? getActivePeerConnections().find(peer => peer.peerId === target) : undefined;
      updateBrainInviteConnection(Boolean(detail));
      // "Syncing" ends when the host's identity/presence has resolved — or
      // after a grace window so a quiet host doesn't hold the banner forever.
      const current = getBrainInviteState();
      if (current.phase === 'syncing' && current.connectedAt) {
        const named = Boolean(detail?.profile?.username || detail?.profile?.displayName || detail?.userId);
        if (named || Date.now() - current.connectedAt >= 12_000) markBrainInviteSynced();
      }
    };
    check();
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [pathname, hash, user, isReady, isEnabled, isConnecting, stats.status, enable, connectToPeer, getPeerId, isPeerBlocked, getActivePeerConnections, invite.startedAt]);
  return null;
}