import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { brainDisplayName } from '@/lib/preview/guestAccess';
import { BRAIN_ROOM_ID, isNetworkChatRoom } from '@/lib/chat/networkChatRoom';
import {
  announceNetworkChatHere,
  getNetworkChatPeers,
  getRoomPresences,
  onNetworkChatPeers,
  onRoomPresence,
  onRoomPresenceRemoved,
} from '@/lib/streaming/webrtcSignalingBridge.standalone';

/** One person in the network chat, wherever they are in the app. */
export interface NetworkChatMember {
  peerId: string;
  username: string;
  /** True when they are inside the Brain (voice-capable), false when chatting from the menu. */
  inBrain: boolean;
}

const HEARTBEAT_MS = 10_000;
const REFRESH_MS = 5_000;

/** Test/internal: merge Brain presences and menu chatters, one row per peer. */
export function mergeNetworkChatMembers(
  brain: { peerId: string; username?: string; userId?: string }[],
  chatters: { peerId: string; username?: string; userId?: string }[],
): NetworkChatMember[] {
  const byPeer = new Map<string, NetworkChatMember>();
  for (const p of chatters) {
    byPeer.set(p.peerId, { peerId: p.peerId, username: p.username || p.peerId.slice(0, 8), inBrain: false });
  }
  for (const p of brain) {
    byPeer.set(p.peerId, { peerId: p.peerId, username: p.username || byPeer.get(p.peerId)?.username || p.peerId.slice(0, 8), inBrain: true });
  }
  return Array.from(byPeer.values());
}

/**
 * Everyone else in the shared network chat: people inside the Brain (room
 * presence) plus people chatting from the main menu. While `active`, this
 * device also tells its peers it has the chat open, so they list it too.
 */
export function useNetworkChatPeers(active: boolean, roomId: string = BRAIN_ROOM_ID): NetworkChatMember[] {
  const { user } = useAuth();
  const [members, setMembers] = useState<NetworkChatMember[]>([]);
  const enabled = active && isNetworkChatRoom(roomId);
  const userId = user?.id;
  const name = user ? brainDisplayName(user) : undefined;

  useEffect(() => {
    if (!enabled) {
      setMembers([]);
      return;
    }
    const refresh = () => setMembers(mergeNetworkChatMembers(getRoomPresences(roomId), getNetworkChatPeers()));
    refresh();
    const offChat = onNetworkChatPeers(refresh);
    const offPresence = onRoomPresence((p) => { if (p.roomId === roomId) refresh(); });
    const offRemoved = onRoomPresenceRemoved((rid) => { if (rid === roomId) refresh(); });
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      offChat();
      offPresence();
      offRemoved();
      clearInterval(timer);
    };
  }, [enabled, roomId]);

  useEffect(() => {
    if (!enabled || !userId) return;
    const beat = () => {
      try { announceNetworkChatHere(roomId, userId, name, true); } catch { /* mesh not up yet */ }
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      try { announceNetworkChatHere(roomId, userId, name, false); } catch { /* ignore */ }
    };
  }, [enabled, roomId, userId, name]);

  return members;
}
