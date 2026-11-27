import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const sent: Array<Record<string, unknown>> = [];
let onMsg: ((m: { type: string }) => void) | null = null;

vi.mock('@/lib/webrtc/manager', () => ({
  getWebRTCManager: () => ({
    isSelfMuted: () => true,
    onMessage: (fn: (m: { type: string }) => void) => { onMsg = fn; return () => { onMsg = null; }; },
    getParticipants: () => [],
    joinRoom: async () => true,
    leaveRoom: async () => {},
    hasLiveAudioTrack: () => false,
    startLocalStream: async () => null,
    toggleAudio: () => {},
  }),
}));
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'sailor' } }) }));
vi.mock('@/lib/virtualHub/avatars', () => ({ loadHubPrefs: () => ({ avatarId: 'rabbit' }) }));
vi.mock('@/lib/streaming/webrtcSignalingBridge.standalone', () => ({
  onRoomWebPeer: () => () => {},
  sendRoomChatMessage: () => {},
  onRoomChatMessage: () => () => {},
  sendRoomPresence: (_room: string, p: Record<string, unknown>) => { sent.push(p); },
  onRoomPresence: () => () => {},
  getRoomPresences: () => [],
  helloRoom: () => {},
  onRoomPresenceRemoved: () => () => {},
  getLocalMeshPeerId: () => 'peer-self',
}));

import { useBrainVoice } from '../useBrainVoice';

beforeEach(() => { sent.length = 0; });

describe('presence announcements keep the boat', () => {
  it('re-announces the latest boat state when someone joins', async () => {
    const { result } = renderHook(() => useBrainVoice(true, 'room-boat', { audio: false }));
    await waitFor(() => expect(result.current.joined).toBe(true));
    const boat = { v: { id: 'dock-1' }, d: { o: 'peer-self', id: 'dock-1', x: 0, z: 1.2 } };
    act(() => { result.current.broadcastSelfPosition([1, 2, 3], [4, 5, 6], boat); });
    sent.length = 0;
    act(() => { onMsg?.({ type: 'peer-joined' }); });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ position: [1, 2, 3], local: [4, 5, 6], boat });
    // Without a boat, the announcement says so too.
    act(() => { result.current.broadcastSelfPosition([1, 2, 3], [4, 5, 6], undefined); });
    sent.length = 0;
    act(() => { onMsg?.({ type: 'peer-joined' }); });
    expect(sent[0].boat).toBeUndefined();
  });
});
