import { describe, expect, it, vi } from 'vitest';
import { onRoomChatMessage, sendRoomChatMessage, startSignalingBridge, stopSignalingBridge, type RoomChatMessage } from '../../streaming/webrtcSignalingBridge.standalone';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_WIRE_MAX_LENGTH } from '../chatLimits';

function bridgeAs(peerId: string, broadcast: (channel: string, payload: unknown) => void) {
  let incoming: ((peer: string, packet: unknown) => void) | undefined;
  startSignalingBridge({
    broadcast, send: async () => true, getPeerId: () => peerId,
    getConnectedPeerIds: () => [],
    onMessage: (_channel, handler) => { incoming = handler; return () => {}; },
  });
  return (peer: string, packet: unknown) => {
    if (!incoming) throw new Error('No mesh receiver');
    incoming(peer, packet);
  };
}

describe('long network chat messages', () => {
  it('allows 30,000 characters', () => {
    expect(CHAT_MESSAGE_MAX_LENGTH).toBe(30_000);
  });

  it('delivers a full-length line intact after a JSON wire round trip', () => {
    const body = Array.from({ length: CHAT_MESSAGE_MAX_LENGTH }, (_, i) => 'aé🙂\n'[i % 4]).join('').slice(0, CHAT_MESSAGE_MAX_LENGTH);
    const text = `line-1\u0001${body}`;
    const broadcast = vi.fn();
    bridgeAs('peer-a', broadcast);
    sendRoomChatMessage('brain-room', text, 'user-a', 'Alice');
    // swarmMesh serialises channel payloads with JSON.stringify before PeerJS sends them.
    const packet = JSON.parse(JSON.stringify(broadcast.mock.calls[0]?.[1]));
    stopSignalingBridge();

    const deliver = bridgeAs('peer-b', () => {});
    const delivered: RoomChatMessage[] = [];
    const unsubscribe = onRoomChatMessage((line) => delivered.push(line));
    try {
      deliver('peer-a', packet);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.text).toBe(text.trim());
    } finally { unsubscribe(); stopSignalingBridge(); }
  });

  it('truncates oversized inbound lines from a peer', () => {
    const deliver = bridgeAs('peer-c', () => {});
    const delivered: RoomChatMessage[] = [];
    const unsubscribe = onRoomChatMessage((line) => delivered.push(line));
    try {
      deliver('peer-x', {
        msgType: 'chat-message', from: 'peer-x', roomId: 'brain-room', ts: Date.now(),
        data: { id: 'huge', text: 'x'.repeat(CHAT_WIRE_MAX_LENGTH * 4), ts: Date.now() },
      });
      expect(delivered[0]?.text.length).toBe(CHAT_WIRE_MAX_LENGTH);
    } finally { unsubscribe(); stopSignalingBridge(); }
  });
});
