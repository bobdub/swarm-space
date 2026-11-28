/**
 * A small mesh in one process: each node loads its own copy of the synapse
 * modules and they talk only through a shared fake Gun registry, the way the
 * Global Cell registry carries them. Checks records flow end to end, signed,
 * and change what a newcomer asks first.
 */
import { describe, expect, it, vi } from 'vitest';

type Fn = (from: string, payload: unknown) => void | Promise<void>;

/**
 * A registry that, like Gun, keeps the latest write per slot, replays them to
 * a new subscriber and hands every new write to every other subscriber.
 */
function fakeRegistry() {
  const subs = new Map<string, Fn>();
  const slots = new Map<string, string>();
  const deliveries: Promise<unknown>[] = [];
  return {
    subscribe(owner: string, fn: Fn) {
      subs.set(owner, fn);
      for (const [from, payload] of slots) if (from !== owner) deliveries.push(Promise.resolve(fn(from, payload)));
      return () => subs.delete(owner);
    },
    publish(from: string, payload: string) {
      slots.set(from, payload);
      for (const [owner, fn] of subs) if (owner !== from) deliveries.push(Promise.resolve(fn(from, payload)));
      return true;
    },
    async drain() {
      while (deliveries.length) await deliveries.shift();
    },
  };
}

async function signer() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return {
    publicKey: btoa(String.fromCharCode(...spki)),
    sign: async (d: Uint8Array) => new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, d)),
  };
}

async function loadNode() {
  vi.resetModules();
  const exchanger = await import('../synapseExchanger');
  const dispatch = await import('../synapticDispatch');
  const layer = await import('../synapseLayer');
  return { exchanger, dispatch, layer };
}

type Link = { to: string; smoothness: number; latencyMs: number };

describe('synapse map across a small mesh', () => {
  it('a newcomer asks the peer the mesh reports as smooth first, and forged slots are refused', async () => {
    localStorage.clear();
    const registry = fakeRegistry();
    const links: Record<string, Link[]> = {
      'peer-a': [{ to: 'peer-fast', smoothness: 0.95, latencyMs: 30 }, { to: 'peer-slow', smoothness: 0.2, latencyMs: 800 }],
      'peer-b': [{ to: 'peer-fast', smoothness: 0.9, latencyMs: 40 }, { to: 'peer-slow', smoothness: 0.3, latencyMs: 700 }],
      'peer-c': [{ to: 'peer-fast', smoothness: 0.85, latencyMs: 50 }],
      'peer-new': [],
    };
    const nodes: Record<string, Awaited<ReturnType<typeof loadNode>>> = {};
    for (const id of Object.keys(links)) {
      const node = await loadNode();
      node.layer._resetSynapseForTests();
      const key = await signer();
      node.exchanger.startSynapseExchanger({
        localPeerId: () => id,
        publish: (_c, _slot, payload) => registry.publish(id, payload),
        subscribe: (_c, fn) => registry.subscribe(id, fn),
        collect: () => ({ conns: links[id].length, phi: 0.7, edges: links[id].map((l) => ({ ...l, weight: 1 })) }),
        signer: async () => key,
        isOnline: () => true,
      });
      nodes[id] = node;
    }
    // Let every first publish sign and land.
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 20));
      await registry.drain();
    }

    const newcomer = nodes['peer-new'];
    expect(newcomer.exchanger.getSynapseMapStats().nodes).toBe(3);
    const view = newcomer.exchanger.getNetworkSynapseView('peer-fast')!;
    expect(view.reporters).toBe(3);
    expect(view.latencyMs).toBe(40);
    expect(newcomer.dispatch.rankBySynapticPath(['peer-slow', 'peer-fast'])).toEqual(['peer-fast', 'peer-slow']);

    // Mallory writes a glowing report into peer-a's slot with her own key.
    const mallory = await signer();
    const forged = await newcomer.exchanger.buildManifoldRecord(
      { peerId: 'peer-a', at: Date.now() + 1_000, conns: 1, phi: 1, edges: [{ to: 'peer-slow', smoothness: 1, latencyMs: 1, weight: 9 }] },
      mallory,
    );
    registry.publish('peer-a', forged!);
    await registry.drain();
    expect(newcomer.exchanger.getSynapseMapStats().refused).toBeGreaterThanOrEqual(1);
    expect(newcomer.dispatch.rankBySynapticPath(['peer-slow', 'peer-fast'])).toEqual(['peer-fast', 'peer-slow']);

    for (const node of Object.values(nodes)) node.exchanger.stopSynapseExchanger();
  });
});
