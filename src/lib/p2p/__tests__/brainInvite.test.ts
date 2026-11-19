import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Brain invite rules', () => {
  beforeEach(async () => {
    const { prepareBrainInvite } = await import('../brainInvite');
    prepareBrainInvite('/brain/join', '#peer-test-reset');
  });
  it('makes a copyable /brain/join#peerID link', async () => {
    const { brainInviteUrl, parseBrainInvite } = await import('../brainInvite');
    expect(brainInviteUrl('https://swarm-space.lovable.app', 'peer-host')).toBe('https://swarm-space.lovable.app/brain/join#peer-host');
    expect(parseBrainInvite('/brain/join', '#peer-host')).toBe('peer-host');
  });
  it('rejects malformed links and ignores other routes', async () => {
    const { parseBrainInvite } = await import('../brainInvite');
    expect(parseBrainInvite('/brain', '#peer-host')).toBeNull();
    expect(parseBrainInvite('/brain/join', '#%')).toBeNull();
    expect(parseBrainInvite('/brain/join', '#https://example.com')).toBeNull();
  });
  it('dials the invite host before the general connection flow, only once', async () => {
    const { dialBrainInviteFirst } = await import('../brainInvite');
    const order: string[] = [];
    const options = { pathname: '/brain/join', hash: '#peer-host', selfId: 'peer-self', isBlocked: () => false,
      dial: (id: string) => { order.push(id); return true; } };
    expect(dialBrainInviteFirst(options)).toBe(true);
    order.push('general-discovery');
    expect(dialBrainInviteFirst(options)).toBe(false);
    expect(order).toEqual(['peer-host', 'general-discovery']);
  });
  it('waits for identity readiness instead of consuming a guest invite early', async () => {
    const { dialBrainInviteFirst } = await import('../brainInvite');
    const dial = vi.fn(() => true);
    const options = { pathname: '/brain/join', hash: '#peer-host', isBlocked: () => false, dial };
    expect(dialBrainInviteFirst({ ...options, selfId: null })).toBe(false);
    expect(dial).not.toHaveBeenCalled();
    expect(dialBrainInviteFirst({ ...options, selfId: 'peer-guest' })).toBe(true);
  });
  it('never calls self or a blocked host', async () => {
    const { dialBrainInviteFirst } = await import('../brainInvite');
    const dial = vi.fn(() => true);
    const options = { pathname: '/brain/join', selfId: 'peer-self', isBlocked: (id: string) => id === 'peer-blocked', dial };
    expect(dialBrainInviteFirst({ ...options, hash: '#peer-self' })).toBe(false);
    expect(dialBrainInviteFirst({ ...options, hash: '#peer-blocked' })).toBe(false);
    expect(dial).not.toHaveBeenCalled();
  });
  it('passes through a syncing stage before fully connected status', async () => {
    const { dialBrainInviteFirst, getBrainInviteState, updateBrainInviteConnection, markBrainInviteSynced } = await import('../brainInvite');
    dialBrainInviteFirst({ pathname: '/brain/join', hash: '#peer-host', selfId: 'peer-self', isBlocked: () => false, dial: () => true });
    expect(getBrainInviteState().phase).toBe('connecting');
    updateBrainInviteConnection(false);
    expect(getBrainInviteState().phase).toBe('connecting');
    updateBrainInviteConnection(true);
    expect(getBrainInviteState().phase).toBe('syncing');
    markBrainInviteSynced();
    expect(getBrainInviteState().phase).toBe('connected');
    updateBrainInviteConnection(false);
    expect(getBrainInviteState().phase).toBe('unavailable');
  });
  it('re-dials automatically while still connecting, on a slow interval, up to a cap', async () => {
    vi.useFakeTimers();
    try {
      const { dialBrainInviteFirst } = await import('../brainInvite');
      const dial = vi.fn(() => true);
      const options = { pathname: '/brain/join', hash: '#peer-host', selfId: 'peer-self', isBlocked: () => false, dial };
      expect(dialBrainInviteFirst(options)).toBe(true);
      // Immediate repeat calls are ignored.
      dialBrainInviteFirst(options);
      expect(dial).toHaveBeenCalledTimes(1);
      // Slow devices: a knock only every 20s, not every 12s.
      vi.advanceTimersByTime(12_000);
      dialBrainInviteFirst(options);
      expect(dial).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(8_000);
      dialBrainInviteFirst(options);
      expect(dial).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(20_000);
        dialBrainInviteFirst(options);
      }
      expect(dial).toHaveBeenCalledTimes(8);
      // Cap reached after about two and a half minutes of knocking.
      vi.advanceTimersByTime(20_000);
      dialBrainInviteFirst(options);
      expect(dial).toHaveBeenCalledTimes(8);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps a refused dial buffered while the node warms up, then allows an explicit retry', async () => {
    vi.useFakeTimers();
    try {
      const { dialBrainInviteFirst, retryBrainInvite, getBrainInviteState, REFUSED_GRACE_MS } = await import('../brainInvite');
      retryBrainInvite();
      const dial = vi.fn(() => false);
      const options = { pathname: '/brain/join', hash: '#peer-host', selfId: 'peer-self', isBlocked: () => false, dial };
      dialBrainInviteFirst(options);
      // Still starting: the next readiness tick asks again instead of giving up.
      expect(getBrainInviteState().phase).toBe('starting');
      vi.advanceTimersByTime(1_000);
      dialBrainInviteFirst(options);
      expect(dial).toHaveBeenCalledTimes(2);
      // A sustained refusal becomes "unavailable" and stops automatic dials.
      vi.advanceTimersByTime(REFUSED_GRACE_MS);
      dialBrainInviteFirst(options);
      expect(getBrainInviteState().phase).toBe('unavailable');
      dialBrainInviteFirst(options);
      expect(dial).toHaveBeenCalledTimes(3);
      retryBrainInvite();
      dialBrainInviteFirst(options);
      expect(dial).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
  it('finds invites inside hash-routed and query-string links', async () => {
    const { parseBrainInvite, resolveInviteLocation, canonicalInviteHref } = await import('../brainInvite');
    expect(parseBrainInvite('/', '#/connect#peer-host')).toBe('peer-host');
    expect(parseBrainInvite('/', '#/connect/#peer-host')).toBe('peer-host');
    expect(parseBrainInvite('/', '#/brain/join#peer-host')).toBe('peer-host');
    expect(parseBrainInvite('/', '#/connect?peer=peer-host')).toBe('peer-host');
    expect(parseBrainInvite('/connect', '', '?peer=peer-host')).toBe('peer-host');
    expect(parseBrainInvite('/', '#/explore#peer-host')).toBeNull();
    expect(parseBrainInvite('/', '#peer-host')).toBeNull();
    expect(resolveInviteLocation('/', '#/connect#bad id')).toEqual({ path: '/connect', peerId: null });
    expect(canonicalInviteHref('/', '#/connect#peer-host')).toBe('/connect#peer-host');
    expect(canonicalInviteHref('/connect', '', '?peer=peer-host&ref=x')).toBe('/connect?ref=x#peer-host');
    expect(canonicalInviteHref('/connect', '#peer-host')).toBeNull();
    expect(canonicalInviteHref('/explore', '')).toBeNull();
  });
  it('dials a hash-routed invite', async () => {
    const { dialBrainInviteFirst, retryBrainInvite } = await import('../brainInvite');
    retryBrainInvite();
    const dial = vi.fn(() => true);
    expect(dialBrainInviteFirst({ pathname: '/', hash: '#/connect#peer-wrapped', selfId: 'peer-self', isBlocked: () => false, dial })).toBe(true);
    expect(dial).toHaveBeenCalledWith('peer-wrapped');
  });
  it('makes a plain /connect#peerID link that dials without the Brain', async () => {
    const { peerConnectUrl, parseBrainInvite, isInvitePath, dialBrainInviteFirst, retryBrainInvite } = await import('../brainInvite');
    expect(peerConnectUrl('https://swarm-space.lovable.app', 'peer-host')).toBe('https://swarm-space.lovable.app/connect#peer-host');
    expect(parseBrainInvite('/connect', '#peer-host')).toBe('peer-host');
    expect(parseBrainInvite('/connect/', '#peer-host')).toBe('peer-host');
    expect(isInvitePath('/explore')).toBe(false);
    retryBrainInvite();
    const dial = vi.fn(() => true);
    expect(dialBrainInviteFirst({ pathname: '/connect', hash: '#peer-sharer', selfId: 'peer-self', isBlocked: () => false, dial })).toBe(true);
    expect(dial).toHaveBeenCalledWith('peer-sharer');
  });
});
