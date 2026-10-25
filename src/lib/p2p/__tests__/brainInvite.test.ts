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
  it('does not unlock connected status until the actual host is connected', async () => {
    const { dialBrainInviteFirst, getBrainInviteState, updateBrainInviteConnection } = await import('../brainInvite');
    dialBrainInviteFirst({ pathname: '/brain/join', hash: '#peer-host', selfId: 'peer-self', isBlocked: () => false, dial: () => true });
    expect(getBrainInviteState().phase).toBe('connecting');
    updateBrainInviteConnection(false);
    expect(getBrainInviteState().phase).toBe('connecting');
    updateBrainInviteConnection(true);
    expect(getBrainInviteState().phase).toBe('connected');
    updateBrainInviteConnection(false);
    expect(getBrainInviteState().phase).toBe('unavailable');
  });
  it('allows an explicit retry but not repeated automatic dials', async () => {
    const { dialBrainInviteFirst, retryBrainInvite, getBrainInviteState } = await import('../brainInvite');
    const dial = vi.fn(() => false);
    const options = { pathname: '/brain/join', hash: '#peer-host', selfId: 'peer-self', isBlocked: () => false, dial };
    dialBrainInviteFirst(options);
    expect(getBrainInviteState().phase).toBe('unavailable');
    dialBrainInviteFirst(options);
    retryBrainInvite();
    dialBrainInviteFirst(options);
    expect(dial).toHaveBeenCalledTimes(2);
  });
});