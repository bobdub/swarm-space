import { useCallback, useEffect, useState } from 'react';
import { BrainChatPanel, type BrainChatLine } from '@/components/brain/BrainChatPanel';
import { useBrainVoice } from '@/hooks/useBrainVoice';
import { useAuth } from '@/hooks/useAuth';
import { brainDisplayName } from '@/lib/preview/guestAccess';
import type { NetworkChatMember } from '@/hooks/useNetworkChatPeers';
import { causalNow } from '@/lib/time/networkClock';
import { armChatChirpAudio, chirpForRemoteLine } from '@/lib/brain/chatChirp';

/**
 * One chat room in the Global Chat: the shared Brain Chat or a member
 * project's scoped channel. Reuses the Brain's chat panel and its mesh chat
 * channel without joining the voice/WebRTC room (chat travels over the mesh
 * broadcast), so opening it never interrupts a live room call. History is
 * hydrated by the panel from the room log and from connected peers.
 */
export function RoomChatView({
  roomId,
  title,
  chatPeers,
}: {
  roomId: string;
  title: string;
  chatPeers?: NetworkChatMember[];
}): JSX.Element {
  const { user } = useAuth();
  // enabled=false: reuse the room chat send/subscribe without joining voice.
  const { sendChatLine, onChatLine } = useBrainVoice(false, roomId, { audio: false });
  const [lines, setLines] = useState<BrainChatLine[]>([]);

  useEffect(() => {
    setLines([]);
  }, [roomId]);

  useEffect(() => {
    armChatChirpAudio();
    return onChatLine((remote) => {
      // Infinity replies are gated by the Brain scene's room-consent flow.
      if (remote.infinityReplyTo) return;
      chirpForRemoteLine(remote);
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
        ts: causalNow(),
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
      roomId={roomId}
      chatPeers={chatPeers}
      variant="embedded"
      title={title}
      showChirpToggle
    />
  );
}
