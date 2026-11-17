import { describe, expect, it, vi } from 'vitest';
import { AccountSkinProtocol } from '../accountSkin';
import { namespaceIdentity } from '@/lib/uqrc/namespaceIdentity';

const WALLET = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';
const flush = () => new Promise(r => setTimeout(r, 20));
const bind = (b: Record<string, unknown>) => ({ type: 'account-bind' as const, bindings: [b] as never, timestamp: Date.now() });

describe('relayed identity anchors', () => {
  it('rejects a forged #discriminator and accepts one that re-derives', async () => {
    const skin = new AccountSkinProtocol('self', vi.fn(), vi.fn());
    const real = await namespaceIdentity('victim', WALLET);
    skin.handleMessage('relay', bind({ userId: 'victim', peerId: 'p1', username: 'Mike', walletAddress: WALLET, namespaceId: 'f'.repeat(64), discriminator: 'ffffffff', boundAt: Date.now(), ttl: 3 }));
    await flush();
    expect(skin.resolve('victim')).toMatchObject({ walletAddress: WALLET });
    expect(skin.resolve('victim')?.discriminator).toBeUndefined();

    skin.handleMessage('relay', bind({ userId: 'victim', peerId: 'p1', username: 'Mike', walletAddress: WALLET, ...real, boundAt: Date.now() + 1, ttl: 3 }));
    await flush();
    expect(skin.resolve('victim')).toMatchObject(real);
  });

  it('copying another user\'s valid coordinates onto a different userId is rejected', async () => {
    const skin = new AccountSkinProtocol('self', vi.fn(), vi.fn());
    const victim = await namespaceIdentity('victim', WALLET);
    skin.handleMessage('relay', bind({ userId: 'impostor', peerId: 'p2', username: 'Mike', walletAddress: WALLET, ...victim, boundAt: Date.now(), ttl: 3 }));
    await flush();
    expect(skin.resolve('impostor')?.discriminator).toBeUndefined();
  });

  it('drops coordinates derived from an old wallet when the wallet changes', () => {
    const skin = new AccountSkinProtocol('self', vi.fn(), vi.fn());
    skin.bindAccount('a', 'p', { walletAddress: WALLET, namespaceId: 'n'.repeat(64), discriminator: 'nnnnnnnn' });
    skin.bindAccount('a', 'p', { walletAddress: OTHER });
    expect(skin.resolve('a')).toMatchObject({ walletAddress: OTHER });
    expect(skin.resolve('a')?.namespaceId).toBeUndefined();
  });

  it('ignores malformed bindings, bad wallets and caps relay TTL', () => {
    const broadcast = vi.fn();
    const skin = new AccountSkinProtocol('self', vi.fn(), broadcast);
    skin.handleMessage('relay', { type: 'account-bind', bindings: 'nope' as never, timestamp: 0 });
    skin.handleMessage('relay', bind({ userId: 7, peerId: 'p', boundAt: 1, ttl: 2 }));
    skin.handleMessage('relay', bind({ userId: 'x', peerId: 'p', boundAt: 'soon', ttl: 2 }));
    expect(skin.getDirectorySnapshot()).toHaveLength(0);
    skin.handleMessage('relay', bind({ userId: 'z', peerId: 'p', walletAddress: '0x0000000000000000000000000000000000000000', boundAt: Date.now(), ttl: 1e9 }));
    expect(skin.resolve('z')?.walletAddress).toBeUndefined();
    expect(skin.resolve('z')!.ttl).toBeLessThanOrEqual(4);
    expect(broadcast.mock.calls.at(-1)?.[1].bindings[0].ttl).toBeLessThanOrEqual(4);
  });
});
