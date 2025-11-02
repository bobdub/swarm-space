import { afterEach, describe, expect, it } from 'bun:test';
import worker, { BeaconDurableObject } from '../src/index';
import {
  createPresenceTicket,
  createEd25519Signer,
  type PresenceTicketEnvelope,
} from '../../../src/lib/p2p/presenceTicket';

type DurableObjectId = { toString(): string };

type DurableObjectStub = { fetch(request: Request): Promise<Response> };

type DurableObjectNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
};

type BeaconState = ConstructorParameters<typeof BeaconDurableObject>[0];
type BeaconEnv = ConstructorParameters<typeof BeaconDurableObject>[1];
type WorkerEnv = Parameters<typeof worker.fetch>[1];

class MemoryStorage implements BeaconState['storage'] {
  #store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.#store.has(key)) {
      return undefined;
    }
    return structuredClone(this.#store.get(key)) as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.#store.set(key, structuredClone(value));
  }
}

class MemoryState implements BeaconState {
  storage: BeaconState['storage'];

  constructor() {
    this.storage = new MemoryStorage();
  }
}

class BeaconStub implements DurableObjectStub {
  constructor(private readonly object: BeaconDurableObject) {}

  fetch(request: Request): Promise<Response> {
    return this.object.fetch(request);
  }
}

class MemoryNamespace implements DurableObjectNamespace {
  #objects = new Map<string, BeaconStub>();

  constructor(private readonly getEnv: () => BeaconEnv) {}

  idFromName(name: string): DurableObjectId {
    return { toString: () => name };
  }

  get(id: DurableObjectId): DurableObjectStub {
    const key = id.toString();
    let stub = this.#objects.get(key);
    if (!stub) {
      const state: BeaconState = new MemoryState();
      const object = new BeaconDurableObject(state, this.getEnv());
      stub = new BeaconStub(object);
      this.#objects.set(key, stub);
    }
    return stub;
  }
}

class BeaconHarness {
  private readonly env: WorkerEnv;
  private readonly namespace: MemoryNamespace;

  constructor(bindings: Record<string, string>) {
    const env = { ...bindings } as WorkerEnv;
    this.env = env;
    this.namespace = new MemoryNamespace(() => this.env);
    this.env.BEACON_STORE = this.namespace;
  }

  async dispatchFetch(input: string, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    return worker.fetch(request, this.env);
  }
}

const originalDateNow = Date.now;

afterEach(() => {
  Date.now = originalDateNow;
});

function setNow(value: number) {
  Date.now = () => value;
}

function toBase64(data: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(data)).toString('base64');
}

async function createTestSigner() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519', namedCurve: 'Ed25519' },
    true,
    ['sign', 'verify']
  );

  const publicKeyBytes = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKey = toBase64(publicKeyBytes);
  const signer = await createEd25519Signer(keyPair.privateKey, publicKey);

  return { signer, publicKey };
}

async function createTicket(
  signer: Awaited<ReturnType<typeof createTestSigner>>['signer'],
  overrides: { peerId: string; userId?: string; ttlMs?: number; now: number }
) {
  const { peerId, userId = `user-${peerId}`, ttlMs = 60_000, now } = overrides;
  return createPresenceTicket({
    peerId,
    userId,
    signer,
    ttlMs,
    now,
  });
}

describe('Beacon Durable Object', () => {
  it('excludes expired tickets when TTL elapses', async () => {
    const { signer, publicKey } = await createTestSigner();
    const harness = new BeaconHarness({ TRUSTED_TICKET_KEYS: publicKey });

    const start = Date.UTC(2025, 0, 1, 0, 0, 0);
    setNow(start);

    const ticket = await createTicket(signer, {
      peerId: 'peer-ttl',
      ttlMs: 1_000,
      now: start,
    });

    const announce = await harness.dispatchFetch('https://beacon.example/announce?community=test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket }),
    });

    expect(announce.status).toBe(200);
    const announceBody = await announce.json();
    expect(announceBody.ok).toBe(true);

    setNow(start + 2_000);

    const peersResponse = await harness.dispatchFetch('https://beacon.example/peers?community=test');
    expect(peersResponse.status).toBe(200);
    const peersBody = await peersResponse.json();
    expect(peersBody.peers).toHaveLength(0);
  });

  it('applies max peer response limits by recency', async () => {
    const { signer, publicKey } = await createTestSigner();
    const harness = new BeaconHarness({
      TRUSTED_TICKET_KEYS: publicKey,
      MAX_PEERS_PER_RESPONSE: '3',
    });

    const base = Date.UTC(2025, 2, 15, 12, 0, 0);

    for (let i = 0; i < 5; i++) {
      const now = base + i * 250;
      setNow(now);
      const ticket = await createTicket(signer, {
        peerId: `peer-${i}`,
        now,
      });
      const response = await harness.dispatchFetch('https://beacon.example/announce?community=test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
    }

    setNow(base + 10_000);

    const peersResponse = await harness.dispatchFetch('https://beacon.example/peers?community=test');
    const peersBody = (await peersResponse.json()) as { peers: PresenceTicketEnvelope[] };
    expect(peersBody.peers).toHaveLength(3);
    const peerIds = peersBody.peers.map((entry) => entry.payload.peerId);
    expect(peerIds).toEqual(['peer-4', 'peer-3', 'peer-2']);
  });
});
