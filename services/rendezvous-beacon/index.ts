type DurableObjectId = {
  toString(): string;
};

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

import {
  verifyPresenceTicket,
  type PresenceTicketEnvelope,
  type PresenceTicketValidationResult
} from '../../src/lib/p2p/presenceTicket';

interface Env {
  BEACON_STORE: DurableObjectNamespace;
  TRUSTED_TICKET_KEYS?: string;
  MAX_PEERS_PER_RESPONSE?: string;
  MAX_TICKETS?: string;
}

interface AnnounceBody {
  ticket: PresenceTicketEnvelope;
  community?: string;
}

interface StoredTicket {
  ticket: PresenceTicketEnvelope;
  receivedAt: number;
  expiresAt: number;
}

interface BeaconResponse {
  ok: boolean;
  peers: PresenceTicketEnvelope[];
  validation?: PresenceTicketValidationResult;
}

const DEFAULT_COMMUNITY = 'mainnet';
const DEFAULT_MAX_TICKETS = 200;
const DEFAULT_MAX_PEERS = 50;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const community = url.searchParams.get('community') ?? DEFAULT_COMMUNITY;
    const id = env.BEACON_STORE.idFromName(community);
    const stub = env.BEACON_STORE.get(id);

    const cloned = await cloneRequestForDo(request, community);
    const response = await stub.fetch(cloned);
    return withCors(response);
  }
};

export class BeaconDurableObject {
  private tickets = new Map<string, StoredTicket>();
  private initialized = false;
  private maxTickets: number;
  private maxPeersPerResponse: number;

  constructor(private state: DurableObjectState, private env: Env) {
    this.maxTickets = Number(env.MAX_TICKETS ?? DEFAULT_MAX_TICKETS) || DEFAULT_MAX_TICKETS;
    this.maxPeersPerResponse = Number(env.MAX_PEERS_PER_RESPONSE ?? DEFAULT_MAX_PEERS) || DEFAULT_MAX_PEERS;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();

    const url = new URL(request.url);
    const community = request.headers.get('X-Rendezvous-Community') ?? DEFAULT_COMMUNITY;

    if (request.method === 'POST' && url.pathname === '/announce') {
      return this.handleAnnounce(request, community);
    }

    if (request.method === 'GET' && url.pathname === '/peers') {
      return this.handlePeers();
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleAnnounce(request: Request, community: string): Promise<Response> {
    try {
      const body = (await request.json()) as AnnounceBody;
      if (!body || typeof body !== 'object' || !body.ticket) {
        return jsonError('Invalid payload', 400);
      }

      const ticket = body.ticket;
      const now = Date.now();
      const validation = await verifyPresenceTicket(ticket, {
        now,
        expectedPeerId: ticket.payload.peerId,
        expectedUserId: ticket.payload.userId,
        trustedPublicKeys: parseTrustedKeys(this.env.TRUSTED_TICKET_KEYS)
      });

      if (!validation.ok) {
        return jsonResponse<BeaconResponse>({ ok: false, peers: [], validation });
      }

      this.tickets.set(ticket.payload.peerId, {
        ticket,
        receivedAt: now,
        expiresAt: ticket.payload.expiresAt
      });

      this.pruneExpired(now);
      await this.persist();

      const peers = this.collectPeers(ticket.payload.peerId, now);
      return jsonResponse<BeaconResponse>({ ok: true, peers });
    } catch (error) {
      console.error('[Beacon] Failed to process announce:', error);
      return jsonError('Failed to process announce', 500);
    }
  }

  private async handlePeers(): Promise<Response> {
    const now = Date.now();
    const pruned = this.pruneExpired(now);
    if (pruned) {
      await this.persist();
    }
    const peers = this.collectPeers(undefined, now);
    return jsonResponse<BeaconResponse>({ ok: true, peers });
  }

  private collectPeers(excludePeerId: string | undefined, now: number): PresenceTicketEnvelope[] {
    const entries = Array.from(this.tickets.values())
      .filter(entry => entry.expiresAt > now)
      .filter(entry => (excludePeerId ? entry.ticket.payload.peerId !== excludePeerId : true))
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, this.maxPeersPerResponse)
      .map(entry => entry.ticket);

    return entries;
  }

  private pruneExpired(now: number): boolean {
    let mutated = false;
    for (const [peerId, record] of this.tickets.entries()) {
      if (record.expiresAt <= now) {
        this.tickets.delete(peerId);
        mutated = true;
      }
    }

    if (this.tickets.size > this.maxTickets) {
      const entries = Array.from(this.tickets.values())
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .slice(0, this.maxTickets);

      this.tickets.clear();
      for (const entry of entries) {
        this.tickets.set(entry.ticket.payload.peerId, entry);
      }
      mutated = true;
    }

    return mutated;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const stored = await this.state.storage.get<StoredTicket[]>('tickets');
    if (stored) {
      const now = Date.now();
      stored.forEach(entry => {
        if (entry.expiresAt > now) {
          this.tickets.set(entry.ticket.payload.peerId, entry);
        }
      });
    }
    this.initialized = true;
  }

  private async persist(): Promise<void> {
    await this.state.storage.put('tickets', Array.from(this.tickets.values()));
  }
}

function parseTrustedKeys(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

async function cloneRequestForDo(request: Request, community: string): Promise<Request> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set('X-Rendezvous-Community', community);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: request.redirect
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.clone().arrayBuffer();
  }

  return new Request(url.toString(), init);
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonResponse<T>(data: T, init: ResponseInit = {}): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      }
    })
  );
}

function jsonError(message: string, status: number): Response {
  return jsonResponse({ ok: false, error: message }, { status });
}
