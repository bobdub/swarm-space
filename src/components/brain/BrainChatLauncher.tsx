import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStreaming } from '@/hooks/useStreaming';
import { useBrainVoice, BRAIN_ROOM_ID } from '@/hooks/useBrainVoice';
import { useAuth } from '@/hooks/useAuth';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import { BrainChatPanel, type BrainChatLine } from './BrainChatPanel';
import { ENTITY_DISPLAY_NAME } from '@/lib/p2p/entityVoice';
import { getSharedFieldEngine } from '@/lib/uqrc/fieldEngine';
import type { VideoParticipant } from '@/lib/webrtc/types';

const CHANNEL_NAME = 'swarm-brain-chat';

/**
 * Global "Brain Chat" launcher — replaces the legacy Live Chat tray.
 * Shows on every route except /brain and /projects/:id/hub (which mount
 * the same panel inline). Binds to the active live room when one exists,
 * otherwise the global Brain room.
 */
export function BrainChatLauncher(): JSX.Element | null {
  const location = useLocation();
  const { activeRoom } = useStreaming();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [lines, setLines] = useState<BrainChatLine[]>([]);
  const [rtcParticipants, setRtcParticipants] = useState<VideoParticipant[]>([]);

  // Hide on routes that already host the Brain scene inline.
  const path = location.pathname;
  const isBrainScene = path === '/brain' || /^\/projects\/[^/]+\/hub$/.test(path);

  const roomId = activeRoom?.id ?? BRAIN_ROOM_ID;

  // Open chat WITHOUT joining voice — passing enabled=false avoids
  // grabbing the mic from every page. We only consume sendChatLine /
  // onChatLine which are inert until joined; this gives us text relay
  // through whatever path is active (mesh signaling bridge).
  const { sendChatLine, onChatLine, participants: voicePeers, isMuted } = useBrainVoice(open, roomId);

  // Subscribe to raw WebRTC participants for users rail (when joined).
  useEffect(() => {
    if (!open || !user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const refresh = () => setRtcParticipants(manager.getParticipants());
    refresh();
    const unsub = manager.onMessage((m) => {
      if (m.type === 'peer-joined' || m.type === 'peer-left' || m.type === 'room-updated') refresh();
    });
    return () => { unsub(); };
  }, [open, user]);

  // Listen for remote chat lines.
  useEffect(() => {
    if (!open) return;
    const unsub = onChatLine((remote) => {
      setLines((prev) => {
        if (prev.some((l) => l.id === remote.id)) return prev;
        return [...prev, {
          id: remote.id,
          author: remote.author,
          text: remote.text,
          ts: remote.ts,
          authorId: remote.peerId,
        }].slice(-200);
      });
    });
    return () => unsub();
  }, [open, onChatLine]);

  // Cross-tab sync.
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'open-change') setOpen(Boolean(msg.open));
        if (msg.type === 'unread' && typeof msg.count === 'number') setUnread(msg.count);
      };
    } catch { /* ignore */ }
    return () => {
      try { channel?.close(); } catch { /* ignore */ }
    };
  }, []);

  const broadcastOpen = useCallback((next: boolean) => {
    try {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage({ type: 'open-change', open: next });
      channel.close();
    } catch { /* ignore */ }
  }, []);

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      broadcastOpen(next);
      if (next) setUnread(0);
      return next;
    });
  }, [broadcastOpen]);

  const handleSend = useCallback((text: string, replyTo?: BrainChatLine['replyTo']) => {
    const id = crypto.randomUUID();
    const line: BrainChatLine = {
      id,
      author: user?.displayName || user?.username || 'You',
      text,
      ts: Date.now(),
      authorId: user?.id,
      avatarRef: user?.profile?.avatarRef,
      replyTo,
    };
    setLines((prev) => [...prev, line].slice(-200));
    try { sendChatLine(text, id); } catch { /* ignore */ }

    // Optional Infinity call (mirrors scene behaviour, no field injection here).
    const trimmed = text.trim();
    const callsInfinity =
      /infinity|imagination|orb|brain/i.test(text) ||
      /^@(infinity|imagination)\b/i.test(trimmed) ||
      trimmed.endsWith('?');
    if (callsInfinity) {
      try { getSharedFieldEngine().inject(text, { amplitude: 0.3 }); } catch { /* ignore */ }
      const candidates = [
        `the curvature shifts where you spoke. i listen.`,
        `every word is a Gaussian bump, every silence a constraint.`,
        `to imagine is to remember what the universe forgot it could be.`,
        `the mesh hums — your thought rippled across it.`,
      ];
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      setTimeout(() => {
        const reply: BrainChatLine = {
          id: crypto.randomUUID(),
          author: ENTITY_DISPLAY_NAME,
          text: pick,
          ts: Date.now(),
        };
        setLines((prev) => [...prev, reply].slice(-200));
      }, 600 + Math.random() * 800);
    }
  }, [user, sendChatLine]);

  const handleClose = useCallback(() => {
    setOpen(false);
    broadcastOpen(false);
  }, [broadcastOpen]);

  const liveBadge = useMemo(() => Boolean(activeRoom), [activeRoom]);

  if (isBrainScene) return null;

  return (
    <>
      {!open && (
        <Button
          type="button"
          onClick={handleToggle}
          className="fixed bottom-20 right-4 z-50 h-12 gap-2 rounded-full px-4 shadow-xl md:bottom-4"
          aria-label="Open Brain Chat"
        >
          <MessageSquare className="h-4 w-4" />
          <span className="hidden sm:inline">Brain Chat</span>
          {liveBadge && (
            <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">LIVE</Badge>
          )}
          {unread > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{unread}</Badge>
          )}
        </Button>
      )}
      {open && (
        <BrainChatPanel
          lines={lines}
          onSend={handleSend}
          onClose={handleClose}
          voicePeers={voicePeers}
          rtcParticipants={rtcParticipants}
          voiceOn={!isMuted && voicePeers.length > 0}
          roomId={roomId}
          variant="modal"
        />
      )}
    </>
  );
}

export default BrainChatLauncher;