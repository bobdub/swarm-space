import { getCurrentUser } from '@/lib/auth';

export type RealmLinkTrust = 'trusted' | 'pending' | 'blocked';

export interface RealmAccountIdentity {
  userId: string | null;
  nodeId: string | null;
  peerId: string | null;
}

export interface RealmTouchpoint {
  peerId: string;
  trust: RealmLinkTrust;
  firstSeenAt: number;
  lastTouchedAt: number;
  touchCount: number;
  lastSurface: string;
  surfaces: string[];
  sources: string[];
  metadata?: Record<string, unknown>;
}

export interface RealmAccountReadModel {
  account: RealmAccountIdentity;
  touchpoints: RealmTouchpoint[];
}

export interface RealmGraphReadModel {
  accounts: RealmAccountReadModel[];
  generatedAt: number;
  activeSurface: string;
}

interface RealmLinkInternal {
  peerId: string;
  trust: RealmLinkTrust;
  firstSeenAt: number;
  lastTouchedAt: number;
  touchCount: number;
  lastSurface: string;
  surfaces: Set<string>;
  sources: Set<string>;
  metadata?: Record<string, unknown>;
}

interface RealmAccountInternal extends RealmAccountIdentity {
  key: string;
  links: Map<string, RealmLinkInternal>;
}

type RealmGraphSubscriber = (snapshot: RealmGraphReadModel) => void;

const MAX_LINKS_PER_ACCOUNT = 350;

function sanitize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getAccountKey(identity: RealmAccountIdentity): string {
  return [identity.userId ?? 'anon', identity.nodeId ?? 'node:none', identity.peerId ?? 'peer:none'].join('|');
}

class RealmGraphStore {
  private accounts = new Map<string, RealmAccountInternal>();
  private listeners = new Set<RealmGraphSubscriber>();
  private activeSurface = 'unknown';

  private resolveLocalIdentity(partial?: Partial<RealmAccountIdentity>): RealmAccountIdentity {
    const user = getCurrentUser();
    return {
      userId: sanitize(partial?.userId ?? user?.id ?? null),
      nodeId: sanitize(partial?.nodeId ?? null),
      peerId: sanitize(partial?.peerId ?? null),
    };
  }

  private getOrCreateAccount(identity: RealmAccountIdentity): RealmAccountInternal {
    const key = getAccountKey(identity);
    const existing = this.accounts.get(key);
    if (existing) {
      return existing;
    }
    const created: RealmAccountInternal = {
      ...identity,
      key,
      links: new Map(),
    };
    this.accounts.set(key, created);
    return created;
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn('[realm-graph] subscriber failure', error);
      }
    }
  }

  setActiveSurface(surface: string): void {
    const normalized = sanitize(surface) ?? 'unknown';
    if (normalized === this.activeSurface) return;
    this.activeSurface = normalized;
    this.notify();
  }

  identifyLocalAccount(partial?: Partial<RealmAccountIdentity>): RealmAccountIdentity {
    const identity = this.resolveLocalIdentity(partial);
    this.getOrCreateAccount(identity);
    return identity;
  }

  recordPeerTouch(options: {
    peerId: string;
    trust?: RealmLinkTrust;
    source: string;
    surface?: string;
    account?: Partial<RealmAccountIdentity>;
    metadata?: Record<string, unknown>;
  }): void {
    const peerId = sanitize(options.peerId);
    if (!peerId) return;
    const trust = options.trust ?? 'trusted';
    const source = sanitize(options.source) ?? 'unknown';
    const surface = sanitize(options.surface) ?? this.activeSurface;
    const account = this.getOrCreateAccount(this.resolveLocalIdentity(options.account));
    const now = Date.now();
    const existing = account.links.get(peerId);
    if (existing) {
      existing.trust = trust === 'blocked' ? 'blocked' : existing.trust === 'blocked' ? 'blocked' : trust;
      existing.lastTouchedAt = now;
      existing.touchCount += 1;
      existing.lastSurface = surface;
      existing.surfaces.add(surface);
      existing.sources.add(source);
      existing.metadata = options.metadata ? { ...(existing.metadata ?? {}), ...options.metadata } : existing.metadata;
    } else {
      account.links.set(peerId, {
        peerId,
        trust,
        firstSeenAt: now,
        lastTouchedAt: now,
        touchCount: 1,
        lastSurface: surface,
        surfaces: new Set([surface]),
        sources: new Set([source]),
        metadata: options.metadata,
      });
      if (account.links.size > MAX_LINKS_PER_ACCOUNT) {
        const sorted = [...account.links.values()].sort((a, b) => b.lastTouchedAt - a.lastTouchedAt).slice(0, MAX_LINKS_PER_ACCOUNT);
        account.links = new Map(sorted.map((item) => [item.peerId, item]));
      }
    }
    this.notify();
  }

  ingestPeerInventory(options: {
    trusted?: string[];
    pending?: string[];
    blocked?: string[];
    source: string;
    surface?: string;
    account?: Partial<RealmAccountIdentity>;
  }): void {
    for (const peerId of options.trusted ?? []) {
      this.recordPeerTouch({ peerId, trust: 'trusted', source: options.source, surface: options.surface, account: options.account });
    }
    for (const peerId of options.pending ?? []) {
      this.recordPeerTouch({ peerId, trust: 'pending', source: options.source, surface: options.surface, account: options.account });
    }
    for (const peerId of options.blocked ?? []) {
      this.recordPeerTouch({ peerId, trust: 'blocked', source: options.source, surface: options.surface, account: options.account });
    }
  }

  buildDiagnosticRealmContext(extra?: Record<string, unknown>): Record<string, unknown> {
    const identity = this.resolveLocalIdentity();
    return {
      realm: {
        userId: identity.userId,
        nodeId: identity.nodeId,
        peerId: identity.peerId,
        surface: this.activeSurface,
      },
      ...(extra ?? {}),
    };
  }

  getSnapshot(): RealmGraphReadModel {
    const accounts = [...this.accounts.values()].map<RealmAccountReadModel>((account) => ({
      account: {
        userId: account.userId,
        nodeId: account.nodeId,
        peerId: account.peerId,
      },
      touchpoints: [...account.links.values()]
        .sort((a, b) => b.lastTouchedAt - a.lastTouchedAt)
        .map((link) => ({
          peerId: link.peerId,
          trust: link.trust,
          firstSeenAt: link.firstSeenAt,
          lastTouchedAt: link.lastTouchedAt,
          touchCount: link.touchCount,
          lastSurface: link.lastSurface,
          surfaces: [...link.surfaces].sort(),
          sources: [...link.sources].sort(),
          metadata: link.metadata,
        })),
    }));
    return {
      accounts,
      activeSurface: this.activeSurface,
      generatedAt: Date.now(),
    };
  }

  subscribe(listener: RealmGraphSubscriber): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }
}

const realmGraph = new RealmGraphStore();

export function getRealmGraphStore(): RealmGraphStore {
  return realmGraph;
}

