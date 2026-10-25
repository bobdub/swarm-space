import { beforeEach, describe, expect, it, vi } from 'vitest';
import { brainDisplayName, canUseMemberFeatures, guestSignupRequired } from '../guestAccess';
import { setGuestName, stopGuestMode } from '../guestMode';
import { setActiveAvatarId, loadHubPrefs } from '@/lib/virtualHub/avatars';
import { isGuestMiningSession } from '@/lib/p2p/swarmMesh.standalone';

const guest = { id: 'guest-a', username: 'guest-internal', publicKey: 'public', wrappedKeyRef: 'guest-key', createdAt: '', _guest: true as const };
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('guest identity boundaries', () => {
  it('keeps the Guest Name while switching avatars, outside shared preferences', () => {
    localStorage.setItem('me', JSON.stringify(guest));
    expect(setGuestName(guest.id, ' Mike ')).toBe(true);
    setActiveAvatarId('cat');
    setActiveAvatarId('dragon');
    const current = JSON.parse(localStorage.getItem('me') || 'null');
    expect(current.guestName).toBe('Mike');
    expect(current.username).toBe('guest-internal');
    expect(brainDisplayName(current)).toBe('Mike');
    expect(loadHubPrefs()).not.toHaveProperty('guestName');
  });
  it('cannot apply a stale guest name to another guest', () => {
    localStorage.setItem('me', JSON.stringify({ ...guest, id: 'guest-b' }));
    expect(setGuestName('guest-a', 'Mike')).toBe(false);
    expect(JSON.parse(localStorage.getItem('me') || 'null')).not.toHaveProperty('guestName');
  });
  it('cannot apply a guest name to a registered account', () => {
    localStorage.setItem('me', JSON.stringify({ ...guest, _guest: false, username: 'member', displayName: 'Member' }));
    expect(setGuestName(guest.id, 'Mike')).toBe(false);
    expect(JSON.parse(localStorage.getItem('me') || 'null').displayName).toBe('Member');
  });
  it('requires signup for a guest own Profile', () => { expect(guestSignupRequired(guest, '/profile')).toBe(true); });
  it('blocks guest Wallet access', () => { expect(guestSignupRequired(guest, '/wallet')).toBe(true); });
  it('blocks guest posting', () => { expect(canUseMemberFeatures(guest)).toBe(false); expect(guestSignupRequired(guest, '/create')).toBe(true); });
  it('blocks the mesh mining loop for guests', () => {
    localStorage.setItem('me', JSON.stringify(guest));
    expect(isGuestMiningSession()).toBe(true);
    localStorage.setItem('me', JSON.stringify({ ...guest, _guest: false }));
    expect(isGuestMiningSession()).toBe(false);
  });
  it('keeps Brain and browsing unchanged for guests', () => {
    for (const path of ['/brain', '/explore', '/u/member', '/node-dashboard']) expect(guestSignupRequired(guest, path)).toBe(false);
  });
  it('clears guest identity on handoff without deleting a registered identity', () => {
    sessionStorage.setItem('preview:guest-active', '1');
    sessionStorage.setItem('me:guestKeys', 'test-placeholder');
    localStorage.setItem('me', JSON.stringify(guest));
    stopGuestMode();
    expect(localStorage.getItem('me')).toBeNull();
    expect(sessionStorage.getItem('me:guestKeys')).toBeNull();
    sessionStorage.setItem('preview:guest-active', '1');
    localStorage.setItem('me', JSON.stringify({ ...guest, _guest: false }));
    stopGuestMode();
    expect(localStorage.getItem('me')).not.toBeNull();
  });
});