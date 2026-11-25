import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store', () => ({ getAll: async () => [], get: async () => undefined }));
vi.mock('../globalCell', () => ({ getGlobalCell: () => ({ sendInviteKnock: vi.fn() }) }));

import { StandaloneSwarmMesh } from '../swarmMesh.standalone';

type Item = { id: string; type: string; author: string; data?: unknown; timestamp: number; hash: string };
type Conn = { open: boolean; peer: string; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
type Harness = {
  peerId: string;
  connections: Map<string, Conn>;
  contentStore: Map<string, Item>;
  handleMessage(from: string, raw: unknown): void;
};

const item = (id: string): Item => ({ id, type: 'post', author: 'user-sharer', data: { id, author: 'user-sharer', content: id }, timestamp: 1, hash: `${id}-1` });
const conn = (peer: string): Conn => ({ open: true, peer, send: vi.fn(), close: vi.fn() });

function setup() {
  localStorage.setItem('swarm-mesh-node-id', 'self');
  const mesh = new StandaloneSwarmMesh();
  const h = mesh as unknown as Harness;
  h.peerId = 'peer-self';
  return { mesh, h };
}

describe('targeted content requests from a share-link guest', () => {
  it('asks open peers with the priority flag', () => {
    const { mesh, h } = setup();
    const a = conn('peer-a');
    const closed = { ...conn('peer-b'), open: false };
    h.connections.set('peer-a', a);
    h.connections.set('peer-b', closed);
    expect(mesh.requestContent(['post-1'])).toBe(1);
    expect(JSON.parse(a.send.mock.calls[0][0] as string)).toMatchObject({ type: 'content-request', ids: ['post-1'], priority: true });
    expect(closed.send).not.toHaveBeenCalled();
  });

  it('answers at once, ahead of a paced backlog to the same peer', () => {
    const { h } = setup();
    const guest = conn('peer-guest');
    h.connections.set('peer-guest', guest);
    for (let i = 0; i < 50; i++) h.contentStore.set(`bulk-${i}`, item(`bulk-${i}`));
    h.contentStore.set('post-1', item('post-1'));

    // The guest's join asks for everything first, which goes out paced ...
    h.handleMessage('peer-guest', JSON.stringify({ type: 'content-request', ids: [...h.contentStore.keys()], from: 'peer-guest' }));
    // ... then names the shared post. No timers have run.
    h.handleMessage('peer-guest', JSON.stringify({ type: 'content-request', ids: ['post-1', 'missing'], from: 'peer-guest', priority: true }));

    expect(guest.send).toHaveBeenCalledTimes(1);
    const reply = JSON.parse(guest.send.mock.calls[0][0] as string);
    expect(reply).toMatchObject({ type: 'content-push', priority: true });
    expect(reply.items.map((i: Item) => i.id)).toEqual(['post-1']);
  });

  it('stores a priority push without waiting for the cooperative queue', () => {
    const { h } = setup();
    h.handleMessage('peer-sharer', JSON.stringify({ type: 'content-push', items: [item('post-1')], from: 'peer-sharer', priority: true }));
    expect(h.contentStore.has('post-1')).toBe(true);
  });
});
