import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, FolderKanban, Lock, MessagesSquare, Sparkles, Users, X } from 'lucide-react';
import { BRAIN_ROOM_ID } from '@/hooks/useBrainVoice';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { brainDisplayName } from '@/lib/preview/guestAccess';
import { isBrainScenePath, setNetworkChatOpen, useNetworkChatOpen } from '@/lib/chat/networkChatStore';
import { useNetworkChatPeers } from '@/hooks/useNetworkChatPeers';
import { getSwarmMeshStandalone } from '@/lib/p2p/swarmMesh.standalone';
import { startDirectMessages, stopDirectMessages, conversationIdFor } from '@/lib/chat/directMessages';
import { chirpForRemoteLine } from '@/lib/brain/chatChirp';
import { isWalletExplicitlyLocked, WALLET_LOCK_EVENT } from '@/lib/auth';
import { DirectMessageUnlockGate } from './DirectMessageUnlockGate';
import {
  useConnectedChatPeers,
  useDirectMessenger,
  useDirectUnread,
  useMemberProjects,
  useRoomUnread,
  useWalletManuallyLocked,
} from '@/hooks/useGlobalChat';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RoomChatView } from './RoomChatView';
import { DirectMessageThread } from './DirectMessageThread';

type RailMode = 'projects' | 'peers';
type Selection = { kind: 'room'; roomId: string; title: string } | { kind: 'peer'; peerId: string };

const BRAIN_SELECTION: Selection = { kind: 'room', roomId: BRAIN_ROOM_ID, title: 'Brain Chat' };

/**
 * Global & Direct Mesh Chat, opened from Chat in the main menu.
 *
 * Projects (default): the network-wide Brain Chat plus a scoped channel for
 * every local project the user belongs to. Peers: end-to-end encrypted
 * direct messages with any peer that has a live mesh link.
 *
 * Room chats reuse the Brain's chat panel and mesh chat channel without
 * joining the voice/WebRTC room, so opening this never interrupts a call.
 */
export function NetworkChatHost(): JSX.Element | null {
  const open = useNetworkChatOpen();
  const { user } = useAuth();
  const { pathname } = useLocation();
  // Brain scenes host their own chat panel; never stack two.
  const isBrainScene = isBrainScenePath(pathname);
  useEffect(() => {
    if (isBrainScene) setNetworkChatOpen(false);
  }, [isBrainScene]);

  // Direct messages are received whether or not the panel is open.
  const userId = user?.id;
  const displayName = user ? brainDisplayName(user) : '';
  const identityKey = user?.publicKey;
  useEffect(() => {
    if (!userId) {
      stopDirectMessages();
      return;
    }
    let messenger: ReturnType<typeof startDirectMessages>;
    try {
      messenger = startDirectMessages(getSwarmMeshStandalone(), { userId, displayName, identityKey });
    } catch {
      return;
    }
    const offDm = messenger.subscribe((e) => {
      if (e.type === 'message' && e.record.senderId !== userId) {
        chirpForRemoteLine({ id: e.record.id, peerId: e.record.peerId, authorId: e.record.senderId });
      }
    });
    // A link that comes back re-handshakes, so lines that failed while it
    // was down are re-sent in both directions.
    let offPeers = () => {};
    try {
      let known = new Set<string>(getSwarmMeshStandalone().getConnectedPeerIds());
      offPeers = getSwarmMeshStandalone().onPeersChange(() => {
        const now = new Set(getSwarmMeshStandalone().getConnectedPeerIds());
        for (const peerId of now) if (!known.has(peerId)) void messenger.refresh(peerId);
        known = now;
      });
    } catch {
      /* mesh not available */
    }
    // Unlocking resumes direct messages: both sides re-send what waited.
    const onLockChange = () => {
      if (!isWalletExplicitlyLocked()) void messenger.resume();
    };
    window.addEventListener(WALLET_LOCK_EVENT, onLockChange);
    window.addEventListener('storage', onLockChange);
    return () => {
      offDm();
      offPeers();
      window.removeEventListener(WALLET_LOCK_EVENT, onLockChange);
      window.removeEventListener('storage', onLockChange);
    };
  }, [userId, displayName, identityKey]);

  if (!open || !user || isBrainScene) return null;
  return <GlobalChatPanel onClose={() => setNetworkChatOpen(false)} />;
}

function GlobalChatPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<RailMode>('projects');
  const [selection, setSelection] = useState<Selection>(BRAIN_SELECTION);
  // On phones the rail and the conversation share the screen in turns.
  const [mobileShowRail, setMobileShowRail] = useState(false);

  // Who else is in the Brain Chat; also tells them we are here.
  const chatPeers = useNetworkChatPeers(true, BRAIN_ROOM_ID);
  const projects = useMemberProjects(user?.id);
  const messenger = useDirectMessenger();
  const peers = useConnectedChatPeers(messenger);
  // A manual wallet lock pauses direct messages only; room chats stay open.
  const walletLocked = useWalletManuallyLocked();
  const dmUnread = useDirectUnread(messenger);
  const activeRoomId = selection.kind === 'room' ? selection.roomId : null;
  const roomUnread = useRoomUnread(
    useMemo(() => [BRAIN_ROOM_ID, ...projects.map((p) => p.roomId)], [projects]),
    user?.id,
    activeRoomId,
  );

  const selectedPeer = selection.kind === 'peer' ? peers.find((p) => p.peerId === selection.peerId) : undefined;
  const peerUnreadTotal = useMemo(() => [...dmUnread.values()].reduce((a, b) => a + b, 0), [dmUnread]);

  const pick = (next: Selection) => {
    setSelection(next);
    if (isMobile) setMobileShowRail(false);
  };

  const containerStyle: React.CSSProperties = isMobile
    ? { height: 'min(80vh, 640px)' }
    : { width: 'min(900px, calc(100vw - 2rem))', height: 'min(72vh, 640px)' };

  const showRail = !isMobile || mobileShowRail;
  const showMain = !isMobile || !mobileShowRail;

  return (
    <div
      role="dialog"
      aria-label="Global Chat"
      className={cn(
        'fixed z-[40] flex flex-col rounded-2xl border border-[hsla(180,80%,60%,0.25)] bg-[hsla(265,70%,8%,0.85)] shadow-2xl backdrop-blur',
        isMobile ? 'inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))]' : 'bottom-20 right-4',
      )}
      style={containerStyle}
    >
      <div className="flex items-center justify-between border-b border-[hsla(180,80%,60%,0.18)] px-3 py-2">
        <div className="flex items-center gap-2">
          {isMobile && !mobileShowRail && (
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setMobileShowRail(true)} aria-label="Show chats">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <MessagesSquare className="h-4 w-4 text-primary" />
          <span className="text-xs font-display uppercase tracking-[0.2em] text-foreground/80">Global Chat</span>
          {isMobile && !mobileShowRail && (
            <span className="truncate text-xs text-foreground/60">
              · {selection.kind === 'room' ? selection.title : selectedPeer?.displayName ?? 'Peer'}
            </span>
          )}
        </div>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-foreground/60 hover:text-foreground" onClick={onClose} aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 p-2">
        {showMain && (
          <div className="min-h-0 min-w-0 flex-1">
            {selection.kind === 'room' ? (
              <RoomChatView
                key={selection.roomId}
                roomId={selection.roomId}
                title={selection.title}
                chatPeers={selection.roomId === BRAIN_ROOM_ID ? chatPeers : undefined}
              />
            ) : walletLocked ? (
              <DirectMessageUnlockGate peerName={selectedPeer?.displayName} />
            ) : selectedPeer ? (
              <DirectMessageThread key={selectedPeer.peerId} peer={selectedPeer} messenger={messenger} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-[hsla(180,80%,60%,0.18)] p-6 text-center text-sm text-foreground/60">
                That peer is no longer connected. Pick someone online from Peers.
              </div>
            )}
          </div>
        )}

        {showRail && (
          <aside className={cn('flex min-h-0 flex-col', isMobile ? 'w-full' : 'w-60 shrink-0')} aria-label="Chats">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-foreground/5 p-1" role="tablist" aria-label="Chat mode">
              {(['projects', 'peers'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs capitalize transition-colors',
                    mode === m ? 'bg-primary/20 text-foreground' : 'text-foreground/60 hover:text-foreground',
                  )}
                >
                  {m === 'projects' ? <FolderKanban className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                  {m}
                  {m === 'peers' && walletLocked && <Lock className="h-3 w-3" aria-label="Wallet locked" />}
                  {m === 'peers' && peerUnreadTotal > 0 && <UnreadDot count={peerUnreadTotal} />}
                </button>
              ))}
            </div>

            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
              {mode === 'projects' ? (
                <>
                  <RailItem
                    active={activeRoomId === BRAIN_ROOM_ID}
                    onClick={() => pick(BRAIN_SELECTION)}
                    highlight
                    icon={<Sparkles className="h-4 w-4 text-primary" />}
                    title="Brain Chat · Global"
                    subtitle={`${peers.length} connected · ${chatPeers.length + 1} in chat`}
                    unread={roomUnread[BRAIN_ROOM_ID]}
                  />
                  {projects.length === 0 ? (
                    <p className="px-2 pt-2 text-[11px] text-foreground/50">Projects you join get their own chat here.</p>
                  ) : (
                    projects.map(({ project, roomId, memberCount }) => (
                      <RailItem
                        key={project.id}
                        active={activeRoomId === roomId}
                        onClick={() => pick({ kind: 'room', roomId, title: project.name })}
                        icon={<Avatar avatarRef={project.profile?.avatarRef} username={project.name} size="sm" className="h-7 w-7" />}
                        title={project.name}
                        subtitle={`${memberCount} member${memberCount === 1 ? '' : 's'}`}
                        unread={roomUnread[roomId]}
                      />
                    ))
                  )}
                </>
              ) : peers.length === 0 ? (
                <p className="px-2 pt-2 text-[11px] text-foreground/50">No peers connected right now. Direct messages need a live link.</p>
              ) : (
                peers.map((p) => {
                  const cid = user && p.userId ? conversationIdFor(user.id, p.userId) : null;
                  return (
                    <RailItem
                      key={p.peerId}
                      active={selection.kind === 'peer' && selection.peerId === p.peerId}
                      onClick={() => pick({ kind: 'peer', peerId: p.peerId })}
                      icon={
                        <span className="relative">
                          <Avatar avatarRef={p.avatarRef} username={p.displayName} displayName={p.displayName} size="sm" className="h-7 w-7" />
                          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background bg-emerald-400" aria-label="Online" />
                        </span>
                      }
                      title={p.displayName}
                      subtitle={`${p.namespace}${p.session?.verified ? " ✓" : ""} · online`}
                      unread={cid ? dmUnread.get(cid) : undefined}
                    />
                  );
                })
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function UnreadDot({ count }: { count: number }): JSX.Element {
  return (
    <Badge className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none" aria-label={`${count} unread`}>
      {count > 99 ? '99+' : count}
    </Badge>
  );
}

function RailItem({
  active,
  onClick,
  icon,
  title,
  subtitle,
  unread,
  highlight = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  unread?: number;
  highlight?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
        highlight && 'border border-primary/40 bg-primary/10',
        active ? 'bg-primary/20' : 'hover:bg-foreground/5',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{title}</span>
        <span className="block truncate text-[11px] text-foreground/55">{subtitle}</span>
      </span>
      {unread ? <UnreadDot count={unread} /> : null}
    </button>
  );
}

export default NetworkChatHost;
