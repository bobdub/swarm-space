/**
 * GroupWare Node service — rides on the existing mesh (no new transport).
 *
 * Discovery:  host sets the 'groupware-host' role on its Global Cell beacon,
 *             so any online user sees it at the bus stop; once a mesh channel
 *             opens the host sends a full `ad` on the 'groupware' channel.
 * Access:     member → access-request → host policy → signed membership.
 * Relay:      members send get/head/put to the host, which verifies the
 *             membership signature + role and talks to its own server.
 *             Server URL and credentials never leave the host.
 */
import { getSwarmMeshStandalone } from '@/lib/p2p/swarmMesh.standalone';
import { getGlobalCell } from '@/lib/p2p/globalCell';
import { getCurrentUser } from '@/lib/auth';
import { personalServerGet, personalServerHead, personalServerPut } from '@/lib/storage/providers/personalServerProvider';
import { getPersonalServer } from '@/lib/storage/providers/personalServerStore';
import { decideAccess, isMembershipCurrent, roleAllows } from './policy';
import { b64ToBytes, bytesToB64, loadOrCreateHostKeys, sha256Hex, signMembership, verifyMembership, type HostKeys } from './crypto';
import {
  GROUPWARE_CHANNEL, GROUPWARE_HOST_ROLE,
  type GroupWareAccessRequest, type GroupWareMessage, type GroupWareNodeAd,
  type GroupWarePolicy, type SignedGroupWareMembership,
} from './types';

const HOST_KEY = 'swarm-groupware-host';
const CLIENT_KEY = 'swarm-groupware-memberships';
const MAX_RELAY_BYTES = 4 * 1024 * 1024;
const RELAY_TIMEOUT_MS = 20_000;

export interface HostConfig {
  enabled: boolean;
  nodeId: string;
  serverId: string;
  name: string;
  policy: GroupWarePolicy;
  maxMembers: number;
  members: Record<string, SignedGroupWareMembership>;
  blocked: string[];
}

export type RequestStatus = 'none' | 'requesting' | 'pending' | 'member' | 'denied';

export interface GroupWareSnapshot {
  host: HostConfig | null;
  pending: GroupWareAccessRequest[];
  nodes: GroupWareNodeAd[];
  /** Hosts seen at the bus stop but not yet connected (no ad yet). */
  waitingHosts: string[];
  status: Record<string, RequestStatus>;
  memberships: Record<string, SignedGroupWareMembership>;
}

type Listener = (s: GroupWareSnapshot) => void;

function load<T>(k: string, fallback: T): T {
  try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : fallback; } catch { return fallback; }
}
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

class GroupWareNode {
  private started = false;
  private host: HostConfig | null = load<HostConfig | null>(HOST_KEY, null);
  private keys: HostKeys | null = null;
  private pending = new Map<string, GroupWareAccessRequest>();
  private nodes = new Map<string, GroupWareNodeAd>();
  private status = new Map<string, RequestStatus>();
  private memberships: Record<string, SignedGroupWareMembership> = load(CLIENT_KEY, {});
  private relayWaiters = new Map<string, (m: Extract<GroupWareMessage, { kind: 'relay-result' }>) => void>();
  private listeners = new Set<Listener>();
  private waitingHosts: string[] = [];

  start() {
    if (this.started) return;
    this.started = true;
    const mesh = getSwarmMeshStandalone();
    mesh.onMessage(GROUPWARE_CHANNEL, (from, payload) => { void this.handle(from, payload as GroupWareMessage); });
    mesh.onPeersChange(() => this.onPeersChanged());
    getGlobalCell().subscribeGatewayPeers(() => this.refreshWaitingHosts());
    setInterval(() => this.refreshWaitingHosts(), 10_000);
    for (const id of Object.keys(this.memberships)) this.status.set(id, 'member');
    if (this.host?.enabled) void this.enableHosting();
    this.onPeersChanged();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => { this.listeners.delete(fn); };
  }

  snapshot(): GroupWareSnapshot {
    const statusObj: Record<string, RequestStatus> = {};
    for (const [k, v] of this.status) statusObj[k] = v;
    return {
      host: this.host,
      pending: [...this.pending.values()],
      nodes: [...this.nodes.values()].sort((a, b) => b.ts - a.ts),
      waitingHosts: this.waitingHosts,
      status: statusObj,
      memberships: this.memberships,
    };
  }

  private emit() { const s = this.snapshot(); for (const l of this.listeners) { try { l(s); } catch { /* ignore */ } } }

  private send(peerId: string, m: GroupWareMessage) { void getSwarmMeshStandalone().send(GROUPWARE_CHANNEL, peerId, m); }

  // ── Host side ───────────────────────────────────────────────────────

  async configureHost(cfg: Pick<HostConfig, 'serverId' | 'name' | 'policy' | 'maxMembers'>) {
    const prev = this.host;
    this.host = {
      enabled: prev?.enabled ?? false,
      nodeId: prev?.nodeId ?? `gw-${crypto.randomUUID().slice(0, 12)}`,
      members: prev?.members ?? {},
      blocked: prev?.blocked ?? [],
      ...cfg,
      maxMembers: Math.max(1, Math.min(500, Math.floor(cfg.maxMembers))),
    };
    save(HOST_KEY, this.host);
    if (this.host.enabled) this.broadcastAd();
    this.emit();
  }

  async enableHosting() {
    if (!this.host) throw new Error('Configure the shared server first.');
    if (!getPersonalServer(this.host.serverId)) throw new Error('That server is no longer linked.');
    this.keys = await loadOrCreateHostKeys();
    this.host.enabled = true;
    save(HOST_KEY, this.host);
    getGlobalCell().setLocalRole(GROUPWARE_HOST_ROLE, true);
    this.broadcastAd();
    this.emit();
  }

  disableHosting() {
    if (this.host) { this.host.enabled = false; save(HOST_KEY, this.host); }
    getGlobalCell().setLocalRole(GROUPWARE_HOST_ROLE, false);
    this.pending.clear();
    this.emit();
  }

  private buildAd(): GroupWareNodeAd | null {
    if (!this.host?.enabled || !this.keys) return null;
    return {
      nodeId: this.host.nodeId,
      hostPeerId: getSwarmMeshStandalone().getPeerId(),
      name: this.host.name,
      policy: this.host.policy,
      hostPublicKey: this.keys.publicJwk,
      memberCount: Object.keys(this.host.members).length,
      maxMembers: this.host.maxMembers,
      ts: Date.now(),
    };
  }

  private broadcastAd(to?: string) {
    const ad = this.buildAd();
    if (!ad) return;
    if (to) this.send(to, { kind: 'ad', ad });
    else getSwarmMeshStandalone().broadcast(GROUPWARE_CHANNEL, { kind: 'ad', ad } satisfies GroupWareMessage);
  }

  async approve(peerId: string) {
    const req = this.pending.get(peerId);
    if (!req) return;
    this.pending.delete(peerId);
    await this.grant(peerId);
  }

  deny(peerId: string) {
    this.pending.delete(peerId);
    if (this.host) this.send(peerId, { kind: 'access-deny', nodeId: this.host.nodeId, reason: 'Host declined' });
    this.emit();
  }

  revoke(peerId: string) {
    if (!this.host) return;
    delete this.host.members[peerId];
    save(HOST_KEY, this.host);
    this.send(peerId, { kind: 'revoke', nodeId: this.host.nodeId });
    this.broadcastAd();
    this.emit();
  }

  private async grant(peerId: string) {
    if (!this.host || !this.keys) return;
    const signed = await signMembership({
      nodeId: this.host.nodeId,
      hostPeerId: getSwarmMeshStandalone().getPeerId(),
      memberPeerId: peerId,
      role: 'writer',
      issuedAt: Date.now(),
      expiresAt: null,
    }, this.keys.privateKey);
    this.host.members[peerId] = signed;
    save(HOST_KEY, this.host);
    this.send(peerId, { kind: 'access-grant', signed });
    this.broadcastAd();
    this.emit();
  }

  private async onAccessRequest(from: string, req: GroupWareAccessRequest) {
    if (!this.host?.enabled || req.nodeId !== this.host.nodeId) return;
    const decision = decideAccess({
      policy: this.host.policy,
      requesterPeerId: from,
      hostPeerId: getSwarmMeshStandalone().getPeerId(),
      memberCount: Object.keys(this.host.members).length,
      maxMembers: this.host.maxMembers,
      blocked: new Set(this.host.blocked),
      existingMembers: new Set(Object.keys(this.host.members)),
    });
    if (decision === 'grant') return this.grant(from);
    if (decision === 'deny') {
      this.send(from, { kind: 'access-deny', nodeId: this.host.nodeId, reason: 'Not accepting this request' });
      return;
    }
    this.pending.set(from, { ...req, requesterPeerId: from });
    this.send(from, { kind: 'access-pending', nodeId: this.host.nodeId });
    this.emit();
  }

  private async onRelay(from: string, m: Extract<GroupWareMessage, { kind: 'relay' }>) {
    const reply = (ok: boolean, result?: unknown, error?: string) =>
      this.send(from, { kind: 'relay-result', reqId: m.reqId, ok, result, error });
    const host = this.host;
    if (!host?.enabled || !this.keys || m.nodeId !== host.nodeId) return reply(false, undefined, 'Node offline');
    const mem = m.signed?.membership;
    if (!mem || mem.memberPeerId !== from || !host.members[from]) return reply(false, undefined, 'Not a member');
    if (!isMembershipCurrent(mem) || !(await verifyMembership(m.signed, this.keys.publicJwk))) return reply(false, undefined, 'Invalid membership');
    if (!roleAllows(mem.role, m.op)) return reply(false, undefined, 'Not permitted');
    const userId = getCurrentUser()?.id ?? '';
    const args = (m.args ?? {}) as { hash?: string; data?: string };
    const hash = typeof args.hash === 'string' && /^[a-f0-9]{64}$/.test(args.hash) ? args.hash : null;
    try {
      if (m.op === 'health') return reply(true, { name: host.name, members: Object.keys(host.members).length });
      if (!hash) return reply(false, undefined, 'Bad hash');
      if (m.op === 'head') return reply(true, await personalServerHead(host.serverId, userId, hash));
      if (m.op === 'get') {
        const bytes = await personalServerGet(host.serverId, userId, hash,
          async (b: ArrayBuffer) => (await sha256Hex(new Uint8Array(b))) === hash);
        return reply(true, bytes ? bytesToB64(new Uint8Array(bytes)) : null);
      }
      if (m.op === 'put') {
        const bytes = b64ToBytes(args.data ?? '');
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_RELAY_BYTES) return reply(false, undefined, 'Bad size');
        if ((await sha256Hex(bytes)) !== hash) return reply(false, undefined, 'Hash mismatch');
        await personalServerPut(host.serverId, userId, hash, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        return reply(true, true);
      }
      return reply(false, undefined, 'Unknown op');
    } catch (e) {
      return reply(false, undefined, e instanceof Error ? e.message : 'Relay failed');
    }
  }

  // ── Member side ─────────────────────────────────────────────────────

  /** Dial a host seen at the bus stop so its ad can arrive. */
  connectToHost(peerId: string): boolean {
    const mesh = getSwarmMeshStandalone();
    if (mesh.getConnectedPeers().includes(peerId)) { this.send(peerId, { kind: 'discover' }); return true; }
    return mesh.connectToPeer(peerId);
  }

  requestAccess(nodeId: string, note?: string) {
    const ad = this.nodes.get(nodeId);
    if (!ad) return;
    const user = getCurrentUser();
    this.status.set(nodeId, 'requesting');
    this.send(ad.hostPeerId, {
      kind: 'access-request',
      request: {
        nodeId, requesterPeerId: getSwarmMeshStandalone().getPeerId(),
        displayName: user?.displayName ?? user?.username, note: note?.slice(0, 200), ts: Date.now(),
      },
    });
    this.emit();
  }

  leave(nodeId: string) {
    delete this.memberships[nodeId];
    save(CLIENT_KEY, this.memberships);
    this.status.set(nodeId, 'none');
    this.emit();
  }

  /** Member API: run a storage op through the host. */
  relay(nodeId: string, op: 'health' | 'head' | 'get' | 'put', args?: { hash?: string; data?: Uint8Array }): Promise<unknown> {
    const signed = this.memberships[nodeId];
    const ad = this.nodes.get(nodeId);
    const hostPeerId = ad?.hostPeerId ?? signed?.membership.hostPeerId;
    if (!signed || !hostPeerId) return Promise.reject(new Error('Not a member of this node'));
    if (!getSwarmMeshStandalone().getConnectedPeers().includes(hostPeerId)) return Promise.reject(new Error('Host is offline'));
    const reqId = crypto.randomUUID();
    const wire = { hash: args?.hash, data: args?.data ? bytesToB64(args.data) : undefined };
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.relayWaiters.delete(reqId); reject(new Error('Host timed out')); }, RELAY_TIMEOUT_MS);
      this.relayWaiters.set(reqId, (r) => { clearTimeout(t); r.ok ? resolve(r.result) : reject(new Error(r.error ?? 'Failed')); });
      this.send(hostPeerId, { kind: 'relay', nodeId, reqId, signed, op, args: wire });
    });
  }

  // ── Dispatcher ──────────────────────────────────────────────────────

  private async handle(from: string, m: GroupWareMessage) {
    if (!m || typeof m !== 'object') return;
    switch (m.kind) {
      case 'discover': this.broadcastAd(from); break;
      case 'ad':
        if (m.ad?.hostPeerId === from && m.ad.nodeId) { this.nodes.set(m.ad.nodeId, m.ad); this.emit(); }
        break;
      case 'access-request': await this.onAccessRequest(from, m.request); break;
      case 'access-pending': this.status.set(m.nodeId, 'pending'); this.emit(); break;
      case 'access-deny': this.status.set(m.nodeId, 'denied'); this.emit(); break;
      case 'access-grant': {
        const ad = this.nodes.get(m.signed?.membership?.nodeId);
        if (!ad || ad.hostPeerId !== from) return;
        if (m.signed.membership.memberPeerId !== getSwarmMeshStandalone().getPeerId()) return;
        if (!(await verifyMembership(m.signed, ad.hostPublicKey))) return;
        this.memberships[ad.nodeId] = m.signed;
        save(CLIENT_KEY, this.memberships);
        this.status.set(ad.nodeId, 'member');
        this.emit();
        break;
      }
      case 'revoke': {
        const s = this.memberships[m.nodeId];
        if (s && s.membership.hostPeerId === from) this.leave(m.nodeId);
        break;
      }
      case 'relay': await this.onRelay(from, m); break;
      case 'relay-result': this.relayWaiters.get(m.reqId)?.(m); this.relayWaiters.delete(m.reqId); break;
    }
  }

  private knownPeers = new Set<string>();
  private onPeersChanged() {
    const peers = getSwarmMeshStandalone().getConnectedPeers();
    for (const p of peers) {
      if (this.knownPeers.has(p)) continue;
      this.knownPeers.add(p);
      this.broadcastAd(p);
      this.send(p, { kind: 'discover' });
    }
    for (const p of [...this.knownPeers]) if (!peers.includes(p)) this.knownPeers.delete(p);
    this.refreshWaitingHosts();
  }

  private refreshWaitingHosts() {
    const self = getSwarmMeshStandalone().getPeerId();
    const hostsWithAds = new Set([...this.nodes.values()].map((n) => n.hostPeerId));
    const next = getGlobalCell().getPeersByRole(GROUPWARE_HOST_ROLE)
      .map((p) => p.peerId).filter((p) => p !== self && !hostsWithAds.has(p));
    if (next.join() !== this.waitingHosts.join()) { this.waitingHosts = next; this.emit(); }
  }
}

let instance: GroupWareNode | null = null;
export function getGroupWareNode(): GroupWareNode {
  if (!instance) { instance = new GroupWareNode(); instance.start(); }
  return instance;
}
