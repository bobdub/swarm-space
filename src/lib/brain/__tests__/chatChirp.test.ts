import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeCtx = {
  state: 'running' as AudioContextState,
  currentTime: 0,
  destination: {},
  createGain: vi.fn(() => ({
    gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn((n: unknown) => n),
    disconnect: vi.fn(),
  })),
  createOscillator: vi.fn(() => ({
    type: 'sine',
    frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn((n: unknown) => n),
    start: vi.fn(),
    stop: vi.fn(),
  })),
  resume: vi.fn(() => Promise.resolve()),
};

vi.mock('@/lib/webrtc/sharedAudioContext', () => ({
  getCallAudioContext: () => fakeCtx,
}));

import {
  CHIRP_MIN_GAP_MS,
  chirpAllowed,
  chirpForRemoteLine,
  isChatChirpEnabled,
  resetChatChirpThrottle,
  setChatChirpEnabled,
} from '../chatChirp';
import { mutePeer, unmutePeer } from '../mutedPeersStore';
import { persistBlocklist } from '@/lib/p2p/blocklistStore';

describe('Brain chat chirp', () => {
  beforeEach(() => {
    localStorage.clear();
    resetChatChirpThrottle();
    fakeCtx.state = 'running';
    fakeCtx.createOscillator.mockClear();
  });

  it('is on by default and remembers being turned off', () => {
    expect(isChatChirpEnabled()).toBe(true);
    setChatChirpEnabled(false);
    expect(isChatChirpEnabled()).toBe(false);
  });

  it('throttles bursts', () => {
    expect(chirpAllowed(null, 0)).toBe(true);
    expect(chirpAllowed(1000, 1000 + CHIRP_MIN_GAP_MS - 1)).toBe(false);
    expect(chirpAllowed(1000, 1000 + CHIRP_MIN_GAP_MS)).toBe(true);
    expect(chirpForRemoteLine({ id: 'a' }, 10_000)).toBe(true);
    expect(chirpForRemoteLine({ id: 'b' }, 10_500)).toBe(false);
    expect(chirpForRemoteLine({ id: 'c' }, 10_000 + CHIRP_MIN_GAP_MS)).toBe(true);
  });

  it('plays two whistles through the shared context', () => {
    chirpForRemoteLine({ id: 'a' }, 0);
    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('stays silent for duplicates, muted people and when turned off', () => {
    expect(chirpForRemoteLine({ id: 'a' }, 0)).toBe(true);
    expect(chirpForRemoteLine({ id: 'a' }, 100_000)).toBe(false);
    mutePeer({ peerId: 'p1', username: 'pat' });
    expect(chirpForRemoteLine({ id: 'b', peerId: 'p1' }, 200_000)).toBe(false);
    unmutePeer('p1');
    setChatChirpEnabled(false);
    expect(chirpForRemoteLine({ id: 'c' }, 300_000)).toBe(false);
  });

  it('stays silent for people on the P2P blocklist', () => {
    persistBlocklist([{ peerId: 'p9', direction: 'all', addedAt: 1 }]);
    expect(chirpForRemoteLine({ id: 'x', peerId: 'p9' }, 0)).toBe(false);
    expect(chirpForRemoteLine({ id: 'y', peerId: 'p8' }, 0)).toBe(true);
  });

  it('does not force audio before the context may run', () => {
    fakeCtx.state = 'closed' as AudioContextState;
    expect(chirpForRemoteLine({ id: 'a' }, 0)).toBe(false);
    expect(fakeCtx.createOscillator).not.toHaveBeenCalled();
  });
});
