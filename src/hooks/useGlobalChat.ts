import { useCallback, useEffect, useState } from 'react';
import { isWalletExplicitlyLocked, WALLET_LOCK_EVENT } from '@/lib/auth';
import type { Project } from '@/types';
import { getAllProjects, isProjectMember } from '@/lib/projects';
import { getSwarmMeshStandalone, type LibraryPeer } from '@/lib/p2p/swarmMesh.standalone';
import { getRoomChatMessages, onRoomChatMessage } from '@/lib/streaming/webrtcSignalingBridge.standalone';
import {
  getDirectMessenger,
  onDirectMessengerChange,
  type DirectMessenger,
  type DirectPeerSession,
} from '@/lib/chat/directMessages';

/** Chat room id of a project's scoped channel (shared with its Brain universe). */
export function projectChatRoomId(projectId: string): string {
  return `brain-project-${projectId}`;
}

// ── Member projects ─────────────────────────────────────────────────

export interface MemberProjectChat {
  project: Project;
  roomId: string;
  memberCount: number;
}

/** Local projects the user belongs to, newest activity first. */
export function useMemberProjects(userId: string | undefined): MemberProjectChat[] {
  const [projects, setProjects] = useState<MemberProjectChat[]>([]);
  useEffect(() => {
    if (!userId) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const all = await getAllProjects();
        if (cancelled) return;
        setProjects(
          all
            .filter((p) => isProjectMember(p, userId))
            .sort((a, b) => (b.meta?.updatedAt ?? '').localeCompare(a.meta?.updatedAt ?? ''))
            .map((project) => ({
              project,
              roomId: projectChatRoomId(project.id),
              memberCount: new Set([project.owner, ...(project.members ?? [])]).size,
            })),
        );
      } catch {
        /* store not ready */
      }
    };
    void load();
    const onCreated = () => void load();
    window.addEventListener('project-created', onCreated);
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.removeEventListener('project-created', onCreated);
      clearInterval(timer);
    };
  }, [userId]);
  return projects;
}

// ── Room unread tracking ─────────────────────────────────────────────

const LAST_READ_KEY = (roomId: string) => `swarm-chat-last-read:${roomId}`;

function readLastRead(roomId: string): number {
  try {
    return Number(localStorage.getItem(LAST_READ_KEY(roomId))) || 0;
  } catch {
    return 0;
  }
}

export function markRoomRead(roomId: string, ts: number = Date.now()): void {
  try {
    if (ts > readLastRead(roomId)) localStorage.setItem(LAST_READ_KEY(roomId), String(ts));
  } catch {
    /* storage unavailable */
  }
}

/** Unread lines per room from other people, since the room was last open here. */
export function useRoomUnread(roomIds: string[], userId: string | undefined, activeRoomId: string | null): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = roomIds.join('|');
  useEffect(() => {
    const ids = key ? key.split('|') : [];
    const recount = () => {
      const next: Record<string, number> = {};
      for (const roomId of ids) {
        const messages = getRoomChatMessages(roomId);
        if (roomId === activeRoomId) {
          const last = messages[messages.length - 1];
          if (last) markRoomRead(roomId, last.ts);
          continue;
        }
        const since = readLastRead(roomId);
        const n = messages.filter((m) => m.ts > since && m.senderUserId !== userId && !m.infinityReplyTo).length;
        if (n > 0) next[roomId] = n;
      }
      setCounts(next);
    };
    recount();
    const off = onRoomChatMessage((m) => {
      if (ids.includes(m.roomId)) recount();
    });
    return off;
  }, [key, userId, activeRoomId]);
  return counts;
}

// ── Connected peers ──────────────────────────────────────────────────

export interface ConnectedChatPeer {
  peerId: string;
  userId?: string;
  displayName: string;
  avatarRef?: string;
  /** `#discriminator`, or a short namespace/peer tag when none is known. */
  namespace: string;
  session?: DirectPeerSession;
}

export function peerNamespace(lib: Pick<LibraryPeer, 'discriminator' | 'namespaceId'> | undefined, peerId: string): string {
  const tag = lib?.discriminator || lib?.namespaceId?.slice(0, 8) || peerId.replace(/^peer-/, '').slice(0, 8);
  return `#${tag.replace(/^#/, '')}`;
}

/** Peers with a live mesh link, joined with their library entry and DM session. */
export function useConnectedChatPeers(messenger: DirectMessenger | null): ConnectedChatPeer[] {
  const [peers, setPeers] = useState<ConnectedChatPeer[]>([]);
  const refresh = useCallback(() => {
    let mesh: ReturnType<typeof getSwarmMeshStandalone>;
    try {
      mesh = getSwarmMeshStandalone();
    } catch {
      setPeers([]);
      return;
    }
    const library = new Map(mesh.getLibrary().map((p) => [p.peerId, p]));
    setPeers(
      mesh.getConnectedPeerIds().map((peerId) => {
        const lib = library.get(peerId);
        const session = messenger?.getSession(peerId);
        return {
          peerId,
          userId: session?.userId ?? lib?.userId,
          displayName: lib?.displayName || session?.displayName || lib?.username || lib?.alias || peerId.slice(0, 8),
          avatarRef: lib?.avatarRef,
          namespace: session?.verified && session.discriminator ? `#${session.discriminator}` : peerNamespace(lib, peerId),
          session,
        };
      }),
    );
  }, [messenger]);

  useEffect(() => {
    refresh();
    let offPeers = () => {};
    let offLibrary = () => {};
    try {
      const mesh = getSwarmMeshStandalone();
      offPeers = mesh.onPeersChange(() => refresh());
      offLibrary = mesh.onLibraryChange(() => refresh());
    } catch {
      /* mesh not available */
    }
    const offDm = messenger?.subscribe((e) => {
      if (e.type === 'session') refresh();
    });
    const timer = setInterval(refresh, 5_000);
    return () => {
      offPeers();
      offLibrary();
      offDm?.();
      clearInterval(timer);
    };
  }, [refresh, messenger]);

  return peers;
}

/** The app's direct messenger, following account changes. */
export function useDirectMessenger(): DirectMessenger | null {
  const [messenger, setMessenger] = useState<DirectMessenger | null>(getDirectMessenger);
  useEffect(() => {
    setMessenger(getDirectMessenger());
    return onDirectMessengerChange(setMessenger);
  }, []);
  return messenger;
}

/** Unread direct messages per conversation id. */
export function useDirectUnread(messenger: DirectMessenger | null): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!messenger) {
      setCounts(new Map());
      return;
    }
    let cancelled = false;
    const recount = () => {
      messenger.unreadCounts().then((c) => { if (!cancelled) setCounts(c); }).catch(() => undefined);
    };
    recount();
    const off = messenger.subscribe((e) => {
      if (e.type === 'message' || e.type === 'status') recount();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [messenger]);
  return counts;
}

/** True while the user has manually locked their wallet (in this tab or another). */
export function useWalletManuallyLocked(): boolean {
  const [locked, setLocked] = useState(isWalletExplicitlyLocked);
  useEffect(() => {
    const refresh = () => setLocked(isWalletExplicitlyLocked());
    refresh();
    window.addEventListener(WALLET_LOCK_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(WALLET_LOCK_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return locked;
}
