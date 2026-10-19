import { describe, expect, it, vi } from 'vitest';
import { onRoomChatMessage, sendRoomChatMessage, startSignalingBridge, stopSignalingBridge, type RoomChatMessage } from '../../streaming/webrtcSignalingBridge.standalone';
import { InfinityRoomConsent } from '../infinityRoomConsent';

describe('Infinity reply over room mesh transport', () => {
  it('preserves the shared reply and actual sender, with one delivery on replay', () => {
    const broadcast = vi.fn();
    let incoming: ((peer: string, packet: unknown) => void) | undefined;
    startSignalingBridge({
      broadcast, send: async () => true, getPeerId: () => 'peer-a',
      getConnectedPeerIds: () => ['peer-b'],
      onMessage: (_channel, handler) => { incoming = handler; return () => {}; },
    });
    sendRoomChatMessage('brain-room', 'infinity:q1\u0001Shared words', 'user-a', 'Alice', undefined, undefined, 'q1');
    const packet = broadcast.mock.calls[0]?.[1];
    expect(packet.userId).toBe('user-a');
    expect(packet.data.infinityReplyTo).toBe('q1');
    stopSignalingBridge();
    startSignalingBridge({
      broadcast: () => {}, send: async () => true, getPeerId: () => 'peer-b',
      getConnectedPeerIds: () => ['peer-a'],
      onMessage: (_channel, handler) => { incoming = handler; return () => {}; },
    });
    const delivered: RoomChatMessage[] = [];
    const consent = new InfinityRoomConsent<RoomChatMessage>();
    const unsubscribe = onRoomChatMessage((line) => delivered.push(...consent.receive(line, 'text').visible));
    try {
      if (!incoming) throw new Error('No mesh receiver');
      incoming('peer-a', packet);
      incoming('peer-a', packet);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.text).toBe('infinity:q1\u0001Shared words');
      expect(delivered[0]?.infinityReplyTo).toBe('q1');
      expect(delivered[0]?.senderUserId).toBe('user-a');
    } finally { unsubscribe(); stopSignalingBridge(); }
  });
});