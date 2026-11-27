import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { RoomPresence } from '@/lib/streaming/webrtcSignalingBridge.standalone';

let presenceHandler: ((p: RoomPresence) => void) | null = null;

vi.mock('@/lib/webrtc/manager', () => ({
  getWebRTCManager: () => ({
    isSelfMuted: () => true,
    onMessage: () => () => {},
    getParticipants: () => [],
    joinRoom: async () => true,
    leaveRoom: async () => {},
    hasLiveAudioTrack: () => false,
    startLocalStream: async () => null,
    toggleAudio: () => {},
  }),
}));
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'walker' } }) }));
vi.mock('@/lib/virtualHub/avatars', () => ({ loadHubPrefs: () => ({ avatarId: 'rabbit' }) }));
vi.mock('@/lib/streaming/webrtcSignalingBridge.standalone', () => ({
  onRoomWebPeer: () => () => {},
  sendRoomChatMessage: () => {},
  onRoomChatMessage: () => () => {},
  sendRoomPresence: () => {},
  onRoomPresence: (fn: (p: RoomPresence) => void) => { presenceHandler = fn; return () => { presenceHandler = null; }; },
  getRoomPresences: () => [],
  helloRoom: () => {},
  onRoomPresenceRemoved: () => () => {},
  getLocalMeshPeerId: () => 'peer-self',
}));

import { useBrainVoice } from '../useBrainVoice';

const presence = (ts: number, position: [number, number, number], avatarId = 'dragon'): RoomPresence => ({
  roomId: 'room-walk', peerId: 'peer-a', username: 'ada', avatarId, position, local: position, ts,
});

describe('walking presence stays out of React', () => {
  it('keeps participants stable while a peer walks and still reports each pose', async () => {
    const { result } = renderHook(() => useBrainVoice(true, 'room-walk', { audio: false }));
    await waitFor(() => expect(result.current.joined).toBe(true));
    const seen: number[] = [];
    act(() => { result.current.onPeerPresence((p) => { seen.push(p.ts); }); });

    act(() => { presenceHandler?.(presence(1, [0, 0, 0])); });
    expect(result.current.participants).toHaveLength(1);
    const roster = result.current.participants;

    // Walking: position-only updates.
    act(() => { presenceHandler?.(presence(2, [1, 0, 0])); });
    act(() => { presenceHandler?.(presence(3, [2, 0, 0])); });
    expect(result.current.participants).toBe(roster);
    expect(seen).toEqual([1, 2, 3]);
    expect(result.current.getPeerPresence('peer-a')?.position).toEqual([2, 0, 0]);

    // A new avatar is a roster change.
    act(() => { presenceHandler?.(presence(4, [2, 0, 0], 'cat')); });
    expect(result.current.participants).not.toBe(roster);
    expect(result.current.participants[0]).toMatchObject({ avatarId: 'cat', position: [2, 0, 0] });
  });
});
