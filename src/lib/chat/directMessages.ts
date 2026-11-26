/**
 * Direct messages between two entangled peers.
 *
 * Transport: the mesh's direct peer data channel
 * (`mesh.send('direct-message', peerId, payload)`), never a broadcast, so a
 * conversation only ever crosses the one link between the two devices.
 *
 * Encryption: each app session makes a fresh ECDH P-256 key pair (the
 * private half is non-extractable and lives only in memory). Selecting a
 * peer sends a `hello` with our public half; both sides derive the same
 * AES-GCM-256 key through HKDF, bound to the conversation id. Every message
 * is sealed with that key, and its metadata (id, sender, timestamp,
 * sequence and causal vector) rides as additional authenticated data, so a
 * relay or a tampered payload fails to decrypt. A new session (either side
 * reloads) triggers a re-handshake and undelivered lines are re-sent.
 *
 * Storage: decrypted lines are kept on this device in the IndexedDB
 * `direct_messages` store so history loads instantly when switching peers.
 */
import { CHAT_MESSAGE_MAX_LENGTH } from './chatLimits';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../crypto';
import {
  createHelloProof,
  loadAppDmSigner,
  openHistoryKey,
  openText,
  parseHelloProof,
  sealText,
  verifyHelloProof,
  type DmHelloProof,
  type DmNamespace,
  type DmSigner,
  type SealedText,
} from './dmIdentity';

export const DM_CHANNEL = 'direct-message';
const WIRE_VERSION = 1;
/** Cap on an inbound ciphertext (base64), well above a max-length line. */
const MAX_CIPHERTEXT_LENGTH = CHAT_MESSAGE_MAX_LENGTH * 6 + 1024;
/** Undelivered lines re-sent after a (re)handshake, newest first. */
const RESEND_LIMIT = 50;

export type DirectMessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface DirectMessageRecord {
  id: string;
  conversationId: string;
  /** Mesh peer id of the other side of the conversation. */
  peerId: string;
  /** User id of the other side of the conversation. */
  peerUserId: string;
  senderId: string;
  text: string;
  timestamp: number;
  /** For lines we received: has the local user seen it. Our own lines are always read. */
  read: boolean;
  /** Delivery state of our own lines; received lines are 'delivered'. */
  status: DirectMessageStatus;
  seq: number;
  vector: Record<string, number>;
  /** True when the text is sealed at rest and this session cannot open it yet. */
  locked?: boolean;
}

export interface DirectMessageStore {
  put(record: DirectMessageRecord): Promise<void>;
  get(id: string): Promise<DirectMessageRecord | undefined>;
  byConversation(conversationId: string): Promise<DirectMessageRecord[]>;
  all(): Promise<DirectMessageRecord[]>;
  /** The namespace this device has seen a user prove, if any. */
  getPin(userId: string): Promise<DmNamespace | undefined>;
  putPin(ns: DmNamespace): Promise<void>;
}

export interface DirectMessageMesh {
  /** Our own link id; bound into handshake proofs so they cannot be replayed from another link. */
  getPeerId?(): string;
  getConnectedPeerIds(): string[];
  send(channel: string, peerId: string, payload: unknown): Promise<boolean>;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
}

export interface DirectMessageIdentity {
  userId: string;
  displayName: string;
  /** The account's public identity key (base64 SPKI). */
  identityKey?: string;
  /** Signs handshakes while the account is unlocked; without it hellos are unproven. */
  signer?: () => Promise<DmSigner | null>;
}

/** What we know about the other side of a link once it has said hello. */
export interface DirectPeerSession {
  peerId: string;
  userId: string;
  displayName: string;
  conversationId: string;
  /**
   * True when the peer proved its user id (identity-key signature) and its
   * namespace (cold-wallet signature) for this session key.
   */
  verified: boolean;
  /** The proven namespace, when verified. */
  namespaceId?: string;
  discriminator?: string;
  /** Short fingerprint of the session key pair, for display. */
  fingerprint: string;
  establishedAt: number;
}

export type DirectMessageEvent =
  | { type: 'message'; record: DirectMessageRecord }
  | { type: 'status'; record: DirectMessageRecord }
  | { type: 'session'; session: DirectPeerSession }
  | { type: 'typing'; peerId: string; conversationId: string; typing: boolean }
  /** A hello claimed a user whose pinned namespace it could not prove. */
  | { type: 'rejected'; peerId: string; userId: string; displayName: string; reason: string };

type Wire =
  | { v: number; kind: 'hello'; userId: string; displayName: string; pub: string; proof?: DmHelloProof; reply?: boolean }
  | { v: number; kind: 'msg'; id: string; conversationId: string; senderId: string; ts: number; seq: number; vector: Record<string, number>; iv: string; ct: string }
  | { v: number; kind: 'ack'; ids: string[] }
  | { v: number; kind: 'read'; ids: string[] }
  | { v: number; kind: 'typing'; typing: boolean };

/** Stable id for the conversation between two users, the same on both sides. */
export function conversationIdFor(a: string, b: string): string {
  return `dm:${[a, b].sort().join(':')}`;
}

/** Associated data binding a line's metadata to its ciphertext. */
export function messageAad(m: { id: string; conversationId: string; senderId: string; ts: number; seq: number; vector: Record<string, number> }): Uint8Array {
  const vector = Object.keys(m.vector).sort().map((k) => [k, m.vector[k]]);
  return new TextEncoder().encode(JSON.stringify([WIRE_VERSION, m.id, m.conversationId, m.senderId, m.ts, m.seq, vector]));
}

function isStr(v: unknown, max = 512): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function isIdList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 200 && v.every((x) => isStr(x, 200));
}

function isVector(v: unknown): v is Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const entries = Object.entries(v as Record<string, unknown>);
  return entries.length <= 4 && entries.every(([k, n]) => k.length <= 200 && typeof n === 'number' && Number.isFinite(n) && n >= 0);
}

/** Test/internal: shape-check an inbound payload; anything else is dropped. */
export function parseWire(raw: unknown): Wire | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  if (w.v !== WIRE_VERSION) return null;
  switch (w.kind) {
    case 'hello':
      if (!isStr(w.userId, 200) || !isStr(w.pub, 256)) return null;
      return {
        v: WIRE_VERSION,
        kind: 'hello',
        userId: w.userId,
        displayName: typeof w.displayName === 'string' ? w.displayName.slice(0, 80) : '',
        pub: w.pub,
        proof: parseHelloProof(w.proof) ?? undefined,
        reply: w.reply === true,
      };
    case 'msg':
      if (!isStr(w.id, 200) || !isStr(w.conversationId, 500) || !isStr(w.senderId, 200)) return null;
      if (typeof w.ts !== 'number' || !Number.isFinite(w.ts)) return null;
      if (typeof w.seq !== 'number' || !Number.isFinite(w.seq) || !isVector(w.vector)) return null;
      if (!isStr(w.iv, 64) || !isStr(w.ct, MAX_CIPHERTEXT_LENGTH)) return null;
      return w as unknown as Wire;
    case 'ack':
    case 'read':
      return isIdList(w.ids) ? { v: WIRE_VERSION, kind: w.kind, ids: w.ids } : null;
    case 'typing':
      return { v: WIRE_VERSION, kind: 'typing', typing: w.typing === true };
    default:
      return null;
  }
}

async function deriveConversationKey(
  privateKey: CryptoKey,
  ownPub: string,
  peerPub: string,
  conversationId: string,
): Promise<CryptoKey> {
  const peerKey = await crypto.subtle.importKey(
    'raw',
    base64ToArrayBuffer(peerPub),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = new TextEncoder().encode([ownPub, peerPub].sort().join('|'));
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(`swarm-dm-v1|${conversationId}`) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function keyFingerprint(a: string, b: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode([a, b].sort().join('|')));
  return Array.from(new Uint8Array(digest).slice(0, 4)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

interface InternalSession extends DirectPeerSession {
  peerPub: string;
  key: CryptoKey;
}

export class DirectMessenger {
  private keyPair: Promise<{ privateKey: CryptoKey; pub: string }>;
  private sessions = new Map<string, InternalSession>();
  /** Waiters for a session with a peer (peerId -> resolvers). */
  private sessionWaiters = new Map<string, Array<(s: DirectPeerSession | null) => void>>();
  private clocks = new Map<string, Record<string, number>>();
  private listeners = new Set<(e: DirectMessageEvent) => void>();
  private off: (() => void) | null = null;
  /** Serialises inbound handling so a hello is applied before the lines behind it. */
  private inbound: Promise<void> = Promise.resolve();

  constructor(
    private readonly mesh: DirectMessageMesh,
    private readonly store: DirectMessageStore,
    readonly identity: DirectMessageIdentity,
  ) {
    this.keyPair = (async () => {
      const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
      return { privateKey: pair.privateKey, pub: arrayBufferToBase64(raw) };
    })();
  }

  start(): void {
    if (this.off) return;
    this.off = this.mesh.onMessage(DM_CHANNEL, (peerId, payload) => {
      this.inbound = this.inbound
        .then(() => this.handle(peerId, payload))
        .catch((err) => console.warn('[DirectMessages] inbound failed', err));
    });
  }

  stop(): void {
    this.off?.();
    this.off = null;
    for (const waiters of this.sessionWaiters.values()) for (const w of waiters) w(null);
    this.sessionWaiters.clear();
    this.listeners.clear();
  }

  subscribe(listener: (e: DirectMessageEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getSession(peerId: string): DirectPeerSession | undefined {
    const s = this.sessions.get(peerId);
    return s ? publicSession(s) : undefined;
  }

  /**
   * Entangle with a connected peer: say hello and resolve once both sides
   * hold the conversation key (null if the peer does not answer in time).
   */
  async connect(peerId: string, timeoutMs = 8_000): Promise<DirectPeerSession | null> {
    const existing = this.sessions.get(peerId);
    if (existing) {
      // Refresh: the peer answers, and any line still waiting is re-sent.
      void this.refresh(peerId);
      return publicSession(existing);
    }
    const wait = new Promise<DirectPeerSession | null>((resolve) => {
      const list = this.sessionWaiters.get(peerId) ?? [];
      list.push(resolve);
      this.sessionWaiters.set(peerId, list);
      setTimeout(() => {
        const current = this.sessionWaiters.get(peerId);
        if (!current) return;
        const i = current.indexOf(resolve);
        if (i >= 0) current.splice(i, 1);
        resolve(this.sessions.get(peerId) ? publicSession(this.sessions.get(peerId)!) : null);
      }, timeoutMs);
    });
    await this.sendHello(peerId, false);
    return wait;
  }

  /**
   * Re-handshake with a peer we already hold a session with (e.g. its link
   * just came back). Our hello makes it re-send its pending lines; its reply
   * makes us re-send ours.
   */
  async refresh(peerId: string): Promise<void> {
    if (!this.sessions.has(peerId)) return;
    await this.sendHello(peerId, false);
  }

  /** Re-send one of our lines that was not delivered. */
  async retry(id: string): Promise<void> {
    const r = await this.store.get(id);
    if (!r || r.locked || r.senderId !== this.identity.userId || r.status === 'delivered' || r.status === 'read') return;
    const session = this.sessions.get(r.peerId);
    if (!session || session.conversationId !== r.conversationId) {
      await this.connect(r.peerId);
      return;
    }
    await this.transmit(session, r);
  }

  async history(conversationId: string): Promise<DirectMessageRecord[]> {
    const rows = await this.store.byConversation(conversationId);
    return rows.sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq);
  }

  /** Unread received lines per conversation. */
  async unreadCounts(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const r of await this.store.all()) {
      if (r.senderId === this.identity.userId || r.read) continue;
      counts.set(r.conversationId, (counts.get(r.conversationId) ?? 0) + 1);
    }
    return counts;
  }

  /** Encrypt and send a line; it is stored first, so it survives a failed send. */
  async send(peerId: string, text: string): Promise<DirectMessageRecord | null> {
    const body = text.trim().slice(0, CHAT_MESSAGE_MAX_LENGTH);
    if (!body) return null;
    const session = this.sessions.get(peerId) ?? (await this.connect(peerId).then(() => this.sessions.get(peerId)));
    if (!session) return null;
    const me = this.identity.userId;
    const clock = await this.clockFor(session.conversationId);
    clock[me] = (clock[me] ?? 0) + 1;
    const record: DirectMessageRecord = {
      id: crypto.randomUUID(),
      conversationId: session.conversationId,
      peerId,
      peerUserId: session.userId,
      senderId: me,
      text: body,
      // Strictly after every line already in this conversation.
      timestamp: Math.max(Date.now(), (await this.lastTimestamp(session.conversationId)) + 1),
      read: true,
      status: 'sending',
      seq: clock[me],
      vector: { ...clock },
    };
    await this.store.put(record);
    this.emit({ type: 'message', record });
    await this.transmit(session, record);
    return record;
  }

  async setTyping(peerId: string, typing: boolean): Promise<void> {
    if (!this.sessions.has(peerId)) return;
    await this.mesh.send(DM_CHANNEL, peerId, { v: WIRE_VERSION, kind: 'typing', typing }).catch(() => false);
  }

  /** Mark received lines in a conversation read, and tell the sender. */
  async markRead(conversationId: string): Promise<void> {
    const rows = await this.store.byConversation(conversationId);
    const unread = rows.filter((r) => r.senderId !== this.identity.userId && !r.read);
    if (unread.length === 0) return;
    for (const r of unread) {
      const next = { ...r, read: true };
      await this.store.put(next);
      this.emit({ type: 'status', record: next });
    }
    const peerId = unread[unread.length - 1].peerId;
    if (this.mesh.getConnectedPeerIds().includes(peerId)) {
      await this.mesh.send(DM_CHANNEL, peerId, { v: WIRE_VERSION, kind: 'read', ids: unread.map((r) => r.id).slice(-200) }).catch(() => false);
    }
  }

  // ── internals ─────────────────────────────────────────────────────

  private emit(e: DirectMessageEvent): void {
    for (const l of this.listeners) {
      try { l(e); } catch { /* ignore */ }
    }
  }

  private async sendHello(peerId: string, reply: boolean): Promise<void> {
    const { pub } = await this.keyPair;
    let proof: DmHelloProof | undefined;
    const self = this.mesh.getPeerId?.();
    if (self && this.identity.signer) {
      try {
        const signer = await this.identity.signer();
        if (signer && signer.userId === this.identity.userId) {
          proof = await createHelloProof(signer, { pub, fromPeerId: self, toPeerId: peerId });
        }
      } catch {
        /* locked: the hello goes unproven */
      }
    }
    await this.mesh.send(DM_CHANNEL, peerId, {
      v: WIRE_VERSION,
      kind: 'hello',
      userId: this.identity.userId,
      displayName: this.identity.displayName,
      pub,
      proof,
      reply,
    }).catch(() => false);
  }

  private async clockFor(conversationId: string): Promise<Record<string, number>> {
    let clock = this.clocks.get(conversationId);
    if (!clock) {
      clock = {};
      for (const r of await this.store.byConversation(conversationId)) {
        for (const [k, n] of Object.entries(r.vector ?? {})) clock[k] = Math.max(clock[k] ?? 0, n);
        clock[r.senderId] = Math.max(clock[r.senderId] ?? 0, r.seq ?? 0);
      }
      this.clocks.set(conversationId, clock);
    }
    return clock;
  }

  private async lastTimestamp(conversationId: string): Promise<number> {
    const rows = await this.store.byConversation(conversationId);
    return rows.reduce((max, r) => Math.max(max, r.timestamp), 0);
  }

  private async transmit(session: InternalSession, record: DirectMessageRecord): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const meta = {
      id: record.id,
      conversationId: record.conversationId,
      senderId: record.senderId,
      ts: record.timestamp,
      seq: record.seq,
      vector: record.vector,
    };
    let ok = false;
    try {
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: messageAad(meta) },
        session.key,
        new TextEncoder().encode(record.text),
      );
      ok = await this.mesh.send(DM_CHANNEL, session.peerId, {
        v: WIRE_VERSION,
        kind: 'msg',
        ...meta,
        iv: arrayBufferToBase64(iv.buffer),
        ct: arrayBufferToBase64(ct),
      });
    } catch {
      ok = false;
    }
    const current = (await this.store.get(record.id)) ?? record;
    if (current.status === 'delivered' || current.status === 'read') return;
    const next: DirectMessageRecord = { ...current, status: ok ? 'sent' : 'failed' };
    await this.store.put(next);
    this.emit({ type: 'status', record: next });
  }

  private async handle(peerId: string, payload: unknown): Promise<void> {
    const wire = parseWire(payload);
    if (!wire) return;
    switch (wire.kind) {
      case 'hello':
        return this.onHello(peerId, wire);
      case 'msg':
        return this.onMsg(peerId, wire);
      case 'ack':
        return this.onReceipt(peerId, wire.ids, 'delivered');
      case 'read':
        return this.onReceipt(peerId, wire.ids, 'read');
      case 'typing': {
        const s = this.sessions.get(peerId);
        if (s) this.emit({ type: 'typing', peerId, conversationId: s.conversationId, typing: wire.typing });
        return;
      }
    }
  }

  private async onHello(peerId: string, hello: Extract<Wire, { kind: 'hello' }>): Promise<void> {
    if (hello.userId === this.identity.userId) return;
    const prior = this.sessions.get(peerId);
    const changed = !prior || prior.peerPub !== hello.pub || prior.userId !== hello.userId;
    if (changed) {
      const { privateKey, pub } = await this.keyPair;
      const conversationId = conversationIdFor(this.identity.userId, hello.userId);
      let key: CryptoKey;
      try {
        key = await deriveConversationKey(privateKey, pub, hello.pub, conversationId);
      } catch {
        return; // not a valid P-256 point
      }
      const proven = hello.proof
        ? await verifyHelloProof(hello.proof, {
          userId: hello.userId,
          pub: hello.pub,
          transportPeerId: peerId,
          selfPeerId: this.mesh.getPeerId?.(),
        })
        : null;
      // Namespaces protect a user id: once this device has seen a user
      // prove a namespace, only a hello proving that same namespace may
      // speak for them.
      const pin = await this.store.getPin(hello.userId).catch(() => undefined);
      if (pin && (!proven || proven.identityKey !== pin.identityKey || proven.namespaceId !== pin.namespaceId)) {
        this.reject(peerId, hello, proven ? 'namespace does not match' : 'no namespace proof');
        return;
      }
      if (proven && !pin) await this.store.putPin(proven).catch(() => undefined);
      const session: InternalSession = {
        peerId,
        userId: hello.userId,
        displayName: hello.displayName || hello.userId.slice(0, 8),
        conversationId,
        verified: Boolean(proven),
        namespaceId: proven?.namespaceId,
        discriminator: proven?.discriminator,
        fingerprint: await keyFingerprint(pub, hello.pub),
        establishedAt: Date.now(),
        peerPub: hello.pub,
        key,
      };
      this.sessions.set(peerId, session);
      this.emit({ type: 'session', session: publicSession(session) });
      const waiters = this.sessionWaiters.get(peerId);
      this.sessionWaiters.delete(peerId);
      for (const w of waiters ?? []) w(publicSession(session));
    }
    // Answer an opening hello so the other side derives the same key; never
    // answer a reply, or two peers would bounce hellos forever.
    if (!hello.reply) await this.sendHello(peerId, true);
    await this.resendUndelivered(peerId);
  }

  private reject(peerId: string, hello: Extract<Wire, { kind: 'hello' }>, reason: string): void {
    // A link that cannot prove the pinned namespace loses any session it had.
    const prior = this.sessions.get(peerId);
    if (prior && prior.userId === hello.userId) this.sessions.delete(peerId);
    this.emit({ type: 'rejected', peerId, userId: hello.userId, displayName: hello.displayName, reason });
    const waiters = this.sessionWaiters.get(peerId);
    this.sessionWaiters.delete(peerId);
    for (const w of waiters ?? []) w(null);
  }

  /** Re-seal and re-send our lines the peer has not acknowledged yet. */
  private async resendUndelivered(peerId: string): Promise<void> {
    const session = this.sessions.get(peerId);
    if (!session) return;
    const rows = await this.history(session.conversationId);
    // Only to the link each line was addressed to. A hello only claims a
    // user id; it does not prove it, so a different link announcing the
    // same user never receives earlier lines without the user choosing to
    // send to it.
    const pending = rows
      .filter((r) => r.senderId === this.identity.userId && r.peerId === peerId && !r.locked
        && (r.status === 'sending' || r.status === 'sent' || r.status === 'failed'))
      .slice(-RESEND_LIMIT);
    for (const r of pending) await this.transmit(session, r);
  }

  private async onMsg(peerId: string, msg: Extract<Wire, { kind: 'msg' }>): Promise<void> {
    const session = this.sessions.get(peerId);
    if (!session) {
      // We lost our session (reload): ask for a fresh handshake; the
      // sender re-sends once it has the new key.
      await this.sendHello(peerId, false);
      return;
    }
    if (msg.senderId !== session.userId || msg.conversationId !== session.conversationId) return;
    const existing = await this.store.get(msg.id);
    if (existing) {
      await this.mesh.send(DM_CHANNEL, peerId, { v: WIRE_VERSION, kind: 'ack', ids: [msg.id] }).catch(() => false);
      return;
    }
    let text: string;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(base64ToArrayBuffer(msg.iv)), additionalData: messageAad(msg) },
        session.key,
        base64ToArrayBuffer(msg.ct),
      );
      text = new TextDecoder().decode(plain).slice(0, CHAT_MESSAGE_MAX_LENGTH);
    } catch {
      // Sealed under a key we no longer hold, or tampered with: re-key.
      await this.sendHello(peerId, false);
      return;
    }
    if (!text.trim()) return;
    const clock = await this.clockFor(session.conversationId);
    for (const [k, n] of Object.entries(msg.vector)) clock[k] = Math.max(clock[k] ?? 0, n);
    clock[msg.senderId] = Math.max(clock[msg.senderId] ?? 0, msg.seq);
    const record: DirectMessageRecord = {
      id: msg.id,
      conversationId: session.conversationId,
      peerId,
      peerUserId: session.userId,
      senderId: msg.senderId,
      text,
      // A clock far from ours means a wrong device clock: place it on arrival.
      timestamp: Math.abs(msg.ts - Date.now()) > 5 * 60_000 ? Date.now() : msg.ts,
      read: false,
      status: 'delivered',
      seq: msg.seq,
      vector: { ...msg.vector },
    };
    await this.store.put(record);
    this.emit({ type: 'message', record });
    await this.mesh.send(DM_CHANNEL, peerId, { v: WIRE_VERSION, kind: 'ack', ids: [msg.id] }).catch(() => false);
  }

  private async onReceipt(peerId: string, ids: string[], status: 'delivered' | 'read'): Promise<void> {
    const session = this.sessions.get(peerId);
    if (!session) return;
    for (const id of ids) {
      const r = await this.store.get(id);
      if (!r || r.senderId !== this.identity.userId || r.conversationId !== session.conversationId) continue;
      if (r.status === 'read' || r.status === status) continue;
      const next = { ...r, status };
      await this.store.put(next);
      this.emit({ type: 'status', record: next });
    }
  }
}

function publicSession(s: InternalSession): DirectPeerSession {
  return {
    peerId: s.peerId,
    userId: s.userId,
    displayName: s.displayName,
    conversationId: s.conversationId,
    verified: s.verified,
    namespaceId: s.namespaceId,
    discriminator: s.discriminator,
    fingerprint: s.fingerprint,
    establishedAt: s.establishedAt,
  };
}

// ── IndexedDB store and app singleton ─────────────────────────────────

const STORE_NAME = 'direct_messages';

/** Stored row: the text is sealed under the account's wrapped history key when it is open. */
type StoredRecord = Omit<DirectMessageRecord, 'locked'> & { sealed?: SealedText };

const PIN_KEY = (userId: string) => `dm-namespace-pin:${userId}`;
const HISTORY_KEY = (userId: string) => `dm-history-key:${userId}`;

/**
 * The account's DM history key, unwrapped from its AES-KW wrap under the
 * namespace-bound KEK. Null while the account is locked.
 */
export function createHistoryKeyring(userId: string, signer: () => Promise<DmSigner | null>): () => Promise<CryptoKey | null> {
  let opened: Promise<CryptoKey | null> | null = null;
  return () => {
    if (!opened) {
      opened = (async () => {
        const s = await signer();
        if (!s || s.userId !== userId) return null;
        const { get, put } = await import('../store');
        const saved = await get<{ k: string; v: { wrapped: string; namespaceId: string } }>('meta', HISTORY_KEY(userId));
        const wrapped = saved?.v.namespaceId === s.namespaceId ? saved.v.wrapped : undefined;
        const { key, wrapped: out, created } = await openHistoryKey(s, wrapped);
        if (created) await put('meta', { k: HISTORY_KEY(userId), v: { wrapped: out, namespaceId: s.namespaceId } });
        return key;
      })().catch(() => null);
      // A locked session may unlock later: try again next time.
      void opened.then((k) => { if (!k) opened = null; });
    }
    return opened;
  };
}

export function createIndexedDbDirectMessageStore(historyKey: () => Promise<CryptoKey | null> = async () => null): DirectMessageStore {
  const seal = async (record: DirectMessageRecord): Promise<StoredRecord> => {
    const { locked: _locked, ...row } = record;
    const key = await historyKey();
    if (!key || record.locked) return row;
    return { ...row, text: '', sealed: await sealText(key, record.id, record.conversationId, record.text) };
  };
  const open = async (row: StoredRecord | undefined, key: CryptoKey | null): Promise<DirectMessageRecord | undefined> => {
    if (!row) return undefined;
    const { sealed, ...rest } = row;
    if (!sealed) {
      // Written before the history key was open: seal it now.
      if (key && row.text) {
        const { put } = await import('../store');
        await put(STORE_NAME, { ...rest, text: '', sealed: await sealText(key, row.id, row.conversationId, row.text) });
      }
      return rest;
    }
    if (!key) return { ...rest, text: '', locked: true };
    try {
      return { ...rest, text: await openText(key, row.id, row.conversationId, sealed) };
    } catch {
      return { ...rest, text: '', locked: true };
    }
  };
  const openAll = async (rows: StoredRecord[]) => {
    const key = await historyKey();
    const out: DirectMessageRecord[] = [];
    for (const r of rows) {
      const o = await open(r, key);
      if (o) out.push(o);
    }
    return out;
  };
  return {
    async put(record) {
      const existing = record.locked ? await (await import('../store')).get<StoredRecord>(STORE_NAME, record.id) : undefined;
      const { put } = await import('../store');
      // A locked row's text is unknown here: keep its sealed copy, change the rest.
      if (existing?.sealed) {
        const { locked: _locked, ...row } = record;
        await put(STORE_NAME, { ...row, text: '', sealed: existing.sealed });
        return;
      }
      await put(STORE_NAME, await seal(record));
    },
    async get(id) {
      const { get } = await import('../store');
      return open(await get<StoredRecord>(STORE_NAME, id), await historyKey());
    },
    async byConversation(conversationId) {
      const { getAllByIndex } = await import('../store');
      return openAll(await getAllByIndex<StoredRecord>(STORE_NAME, 'conversationId', conversationId));
    },
    async all() {
      const { getAll } = await import('../store');
      // Counting unread needs no text; skip unsealing.
      return (await getAll<StoredRecord>(STORE_NAME)).map(({ sealed: _sealed, ...r }) => r);
    },
    async getPin(userId) {
      const { get } = await import('../store');
      return (await get<{ k: string; v: DmNamespace }>('meta', PIN_KEY(userId)))?.v;
    },
    async putPin(ns) {
      const { put } = await import('../store');
      await put('meta', { k: PIN_KEY(ns.userId), v: ns });
    },
  };
}

let active: DirectMessenger | null = null;
const activeListeners = new Set<(m: DirectMessenger | null) => void>();

/** Start (or restart for a new account) the app's direct messenger. */
export function startDirectMessages(mesh: DirectMessageMesh, identity: DirectMessageIdentity): DirectMessenger {
  if (active && active.identity.userId === identity.userId) return active;
  active?.stop();
  // Keys are unlocked once per session; keep the signer after it first loads.
  let cached: DmSigner | null = null;
  const signer = identity.signer ?? (async () => {
    if (!cached) cached = await loadAppDmSigner(identity.userId, identity.identityKey);
    return cached;
  });
  active = new DirectMessenger(
    mesh,
    createIndexedDbDirectMessageStore(createHistoryKeyring(identity.userId, signer)),
    { ...identity, signer },
  );
  active.start();
  for (const l of activeListeners) l(active);
  return active;
}

export function stopDirectMessages(): void {
  active?.stop();
  active = null;
  for (const l of activeListeners) l(null);
}

export function getDirectMessenger(): DirectMessenger | null {
  return active;
}

export function onDirectMessengerChange(listener: (m: DirectMessenger | null) => void): () => void {
  activeListeners.add(listener);
  return () => { activeListeners.delete(listener); };
}
