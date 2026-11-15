import { beforeEach, expect, vi, test } from "vitest";

const recipient = vi.hoisted(() => ({ id: "aabbccddeeff0011", username: "native-recipient" }));
const state = vi.hoisted(() => ({ users: new Map<string, Record<string, unknown>>(), swarm: [] as Array<{ peerId: string; userId?: string; displayName?: string }>, builder: [] as Array<{ peerId: string; userId?: string }>, connections: [] as Array<Record<string, unknown>>, put: vi.fn() }));
vi.mock("@/lib/store", () => ({
  get: async (_store: string, id: string) => state.users.get(id),
  getAll: async (store: string) => store === 'connections' ? state.connections : [...state.users.values()],
  put: async (_store: string, user: Record<string, unknown>) => { state.put(user); state.users.set(String(user.id), user); },
}));
vi.mock('@/lib/p2p/swarmMesh.standalone', () => ({ getSwarmMeshStandalone: () => ({ getLibrary: () => state.swarm }) }));
vi.mock('@/lib/p2p/builderMode.standalone-archived', () => ({ getStandaloneBuilderMode: () => ({ getLibrary: () => state.builder }) }));
const { nativeWalletAddress, resolveNativeWalletRecipient, hydrateNativeWalletPeer } = await import("./nativeAddress");
beforeEach(() => {
  state.users.clear(); state.users.set(recipient.id, recipient);
  state.swarm = []; state.builder = []; state.connections = []; state.put.mockClear(); localStorage.clear();
});

test("native receiving aliases are stable clean 20-byte addresses without a swarm scheme", async () => {
  expect(await nativeWalletAddress(recipient.id)).toBe("0x68588ba69f51bf95f0e040b0d8f646e9fe526218");
});

test("clean receiving aliases resolve case-insensitively to the existing ledger identity", async () => {
  expect((await resolveNativeWalletRecipient(" 0x68588BA69F51BF95F0E040B0D8F646E9FE526218 ")).id).toBe(recipient.id);
});

test("legacy receiving addresses retain their existing ledger identity", async () => {
  expect((await resolveNativeWalletRecipient("swarm:aabbccddeeff0011")).id).toBe(recipient.id);
  expect((await resolveNativeWalletRecipient("aabbccddeeff0011")).id).toBe(recipient.id);
  await expect(resolveNativeWalletRecipient("swarm:unknown")).rejects.toThrow("recipient not found");
});

test.each(['raw', 'swarm', 'alias'])('resolves and hydrates a live library-only member using %s input', async mode => {
  state.swarm = [{ peerId: 'peer-remote', userId: 'remote-member', displayName: 'Remote' }];
  const address = mode === 'alias' ? (await nativeWalletAddress('remote-member')).toUpperCase().replace('0X', '0x') : mode === 'swarm' ? 'swarm:remote-member' : 'remote-member';
  expect(await resolveNativeWalletRecipient(address)).toMatchObject({ id: 'remote-member', displayName: 'Remote', publicKey: '' });
  expect(state.users.get('remote-member')?.id).toBe('remote-member');
  expect((await resolveNativeWalletRecipient('remote-member')).id).toBe('remote-member');
  expect(state.put).toHaveBeenCalledTimes(1);
});

test('resolves a Builder member via the same native identity', async () => {
  state.builder = [{ peerId: 'peer-builder', userId: 'builder-member' }];
  expect((await resolveNativeWalletRecipient('swarm:builder-member')).id).toBe('builder-member');
});

test.each([false, true])('resolves account-scoped connection records in either direction (%s)', async reversed => {
  localStorage.setItem('me', JSON.stringify({ id: 'local' }));
  state.connections = [{ userId: reversed ? 'remote' : 'local', connectedUserId: reversed ? 'local' : 'remote', status: 'connected' }];
  expect((await resolveNativeWalletRecipient(await nativeWalletAddress('remote'))).id).toBe('remote');
});

test('does not hydrate blocked, unrelated or guest contacts', async () => {
  localStorage.setItem('me', JSON.stringify({ id: 'local' }));
  state.connections = [{ userId: 'local', connectedUserId: 'blocked', status: 'blocked' }, { userId: 'other', connectedUserId: 'unrelated', status: 'connected' }];
  state.swarm = [{ peerId: 'guest', displayName: 'Guest' }];
  for (const id of ['blocked', 'unrelated', 'guest']) await expect(resolveNativeWalletRecipient(`swarm:${id}`)).rejects.toThrow('recipient not found');
  expect(state.put).not.toHaveBeenCalled();
});

test('peer hydration preserves existing account key, balances and profile', async () => {
  const account = { ...recipient, publicKey: 'existing-public-key', credits: 70, profile: { bio: 'Keep me' } };
  state.users.set(recipient.id, account);
  expect(await hydrateNativeWalletPeer({ userId: recipient.id, username: 'changed' })).toEqual(account);
  expect(state.put).not.toHaveBeenCalled();
});