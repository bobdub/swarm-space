import { describe, expect, it, vi } from 'vitest';
import { AccountSkinProtocol } from '../accountSkin';

describe('collision-safe handle directory', () => {
  it('retains both users with the same handle and queries both', () => {
    const send = vi.fn(), resolved = vi.fn();
    const skin = new AccountSkinProtocol('self', send, vi.fn(), resolved);
    skin.bindAccount('a', 'peer-a', { username: 'Mike' });
    skin.bindAccount('b', 'peer-b', { username: 'mike' });
    expect(skin.resolveAllByUsername('MIKE').map(b => b.userId)).toEqual(['a', 'b']);
    resolved.mockClear();
    skin.queryByUsername('mike');
    expect(resolved).toHaveBeenCalledTimes(2);
    skin.handleMessage('peer-query', { type: 'account-query', queryUsername: 'mike', timestamp: Date.now() });
    expect(send.mock.calls[0][2].bindings.map((b: { userId: string }) => b.userId)).toEqual(['a', 'b']);
    skin.bindAccount('a', 'peer-rotated', { username: 'Alice' });
    expect(skin.resolveAllByUsername('mike').map(b => b.userId)).toEqual(['b']);
    expect(skin.resolveByUsername('alice')?.userId).toBe('a');
  });
  it('carries public namespace metadata through digest and announce', () => {
    const send = vi.fn(), broadcast = vi.fn();
    const skin = new AccountSkinProtocol('self', send, broadcast);
    skin.setLocalPeerId('peer-self');
    const coordinates = { walletAddress: '0x1111111111111111111111111111111111111111', namespaceId: 'digest', discriminator: 'tag' };
    skin.bindAccount('self', 'peer-self', coordinates);
    skin.announceBinding();
    expect(broadcast.mock.calls[0][1].bindings[0]).toMatchObject(coordinates);
    skin.sendDigest('peer-other');
    expect(send.mock.calls[0][2].bindings[0]).toMatchObject(coordinates);
  });
});