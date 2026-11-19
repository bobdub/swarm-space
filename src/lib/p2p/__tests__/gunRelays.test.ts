import { describe, expect, it } from 'vitest';
import { DEFAULT_GUN_RELAYS, resolveGunRelays } from '../gunRelays';

describe('gun relays', () => {
  it('keeps the public Gun relay first by default', () => {
    expect(DEFAULT_GUN_RELAYS[0]).toBe('https://relay.peer.ooo/gun');
    expect(resolveGunRelays()).toEqual([...DEFAULT_GUN_RELAYS]);
  });

  it('puts configured relays ahead of the defaults without duplicates', () => {
    expect(resolveGunRelays({ VITE_GUN_RELAYS: '["https://my.relay/gun","https://relay.peer.ooo/gun"]' }))
      .toEqual(['https://my.relay/gun', ...DEFAULT_GUN_RELAYS]);
    expect(resolveGunRelays({ VITE_GUN_RELAYS: 'wss://a.example/gun, not a url' })[0]).toBe('wss://a.example/gun');
    expect(resolveGunRelays({ VITE_GUN_RELAYS: 'not a url' })).toEqual([...DEFAULT_GUN_RELAYS]);
  });
});
