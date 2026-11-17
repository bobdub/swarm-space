import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BrainChatPanel, type BrainChatLine } from '@/components/brain/BrainChatPanel';
import { BRAIN_ROOM_ID, useBrainVoice } from '@/hooks/useBrainVoice';
import { useAuth } from '@/hooks/useAuth';
import { brainDisplayName } from '@/lib/preview/guestAccess';
import { setNetworkChatOpen, useNetworkChatOpen } from '@/lib/chat/networkChatStore';

/**
 * Global host for the network chat panel opened from the main menu.
 *
 * Reuses the Brain's chat panel and its mesh chat channel on the shared
 * Brain room, so messages sent here reach people inside the Brain and
 * vice versa. It does NOT join the voice/WebRTC room (chat travels over
 * the mesh broadcast), so opening it never interrupts a live room call.
 */
export function NetworkChatHost(): JSX.Element | null {
  const open = useNetworkChatOpen();
  const { user } = useAuth();
  const { pathname } = useLocation();
  // Brain scenes host their own chat panel; never stack two.
  const isBrainScene =
    pathname === '/brain' || pathname === '/brain/join' || /^\/projects\/[^/]+\/hub$/.test(pathname);
  useEffect(() => {
    if (isBrainScene) setNetworkChatOpen(false);
  }, [isBrainScene]);
  if (!open || !user || isBrainScene) return null;
  return <NetworkChatPanel onClose={() => setNetworkChatOpen(false)} />;
}

function NetworkChatPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { user } = useAuth();
  // enabled=false: reuse the room chat send/subscribe without joining voice.
  const { sendChatLine, onChatLine } = useBrainVoice(false, BRAIN_ROOM_ID, { audio: false });
  const [lines, setLines] = useState<BrainChatLine[]>([]);

  useEffect(() => {
    return onChatLine((remote) => {
      // Infinity replies are gated by the Brain scene's room-consent flow.
      if (remote.infinityReplyTo) return;
      setLines((prev) =>
        prev.some((l) => l.id === remote.id)
          ? prev
          : [
              ...prev,
              {
                id: remote.id,
                author: remote.author,
                text: remote.text,
                ts: remote.ts,
                authorId: remote.authorId,
                peerId: remote.peerId,
              },
            ].slice(-100),
      );
    });
  }, [onChatLine]);

  const handleSend = useCallback(
    (text: string) => {
      const line: BrainChatLine = {
        id: crypto.randomUUID(),
        author: user ? brainDisplayName(user) : 'You',
        text,
        ts: Date.now(),
        authorId: user?.id,
        avatarRef: user?.profile?.avatarRef,
      };
      setLines((prev) => [...prev, line].slice(-100));
      try {
        sendChatLine(text, line.id);
      } catch {
        /* ignore */
      }
    },
    [sendChatLine, user],
  );

  return (
    <BrainChatPanel
      lines={lines}
      onSend={handleSend}
      onClose={onClose}
      roomId={BRAIN_ROOM_ID}
      variant="modal"
    />
  );
}

export default NetworkChatHost;
