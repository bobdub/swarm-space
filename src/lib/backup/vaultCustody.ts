/**
 * Recovery vault storage + peer custody protocol.
 *
 * - The owner keeps its active envelope at `meta` → `recovery:vault:<userId>`.
 * - Peers hold other people's envelopes at `recovery:custody:<userId>`, but
 *   only after `verifyRecoveryVault` passes and only when the signed version
 *   is strictly higher than what they already hold. Custody is capped so a
 *   flood of throwaway identities cannot fill a device.
 * - A peer that stores an envelope answers with an `ack`; the owner records
 *   which peers hold its current version (`recovery:acks:<userId>`).
 * - Anyone may `query` by userId: the envelope is ciphertext that only the
 *   outer-shell passphrase opens, and the recovering device has nothing else.
 *
 * Channel: `recovery-vault` on the standalone mesh's send/onMessage API.
 */

import { get, put, remove } from "../store";
import {
  sealRecoveryVault,
  sameEnvelope,
  supersedes,
  verifyRecoveryVault,
  type RecoveryVaultEnvelope,
  type VaultProfile,
} from "./recoveryVault";

export const VAULT_CHANNEL = "recovery-vault";
export const MAX_HELD_VAULTS = 256;
export const CUSTODY_EVENT = "recovery-custody-updated";

const OWN_KEY = (userId: string) => `recovery:vault:${userId}`;
const HELD_KEY = (userId: string) => `recovery:custody:${userId}`;
const ACKS_KEY = (userId: string) => `recovery:acks:${userId}`;
const HELD_INDEX_KEY = "recovery:custody-index";

// ── Local records ──────────────────────────────────────────────────────

export interface OwnVaultRecord {
  envelope: RecoveryVaultEnvelope;
  /** True while the shell is still the genesis default (signup password). */
  genesisDefault: boolean;
}

export interface CustodyAcks {
  version: number;
  peers: Record<string, { at: number; name?: string }>;
}

interface HeldRecord {
  envelope: RecoveryVaultEnvelope;
  receivedAt: number;
  fromPeer: string;
}

type MetaRow<T> = { k: string; v: T };

function announce(userId: string): void {
  try {
    window.dispatchEvent(new CustomEvent(CUSTODY_EVENT, { detail: { userId } }));
  } catch { /* non-browser */ }
}

export async function getOwnVault(userId: string): Promise<OwnVaultRecord | null> {
  try {
    return (await get<MetaRow<OwnVaultRecord>>("meta", OWN_KEY(userId)))?.v ?? null;
  } catch {
    return null;
  }
}

async function saveOwnVault(record: OwnVaultRecord): Promise<void> {
  await put("meta", { k: OWN_KEY(record.envelope.userId), v: record });
  await put("meta", { k: ACKS_KEY(record.envelope.userId), v: { version: record.envelope.version, peers: {} } satisfies CustodyAcks });
  announce(record.envelope.userId);
}

export async function getCustodyAcks(userId: string): Promise<CustodyAcks> {
  try {
    return (await get<MetaRow<CustodyAcks>>("meta", ACKS_KEY(userId)))?.v ?? { version: 0, peers: {} };
  } catch {
    return { version: 0, peers: {} };
  }
}

async function recordAck(userId: string, version: number, peerId: string, name?: string, signature?: string): Promise<boolean> {
  const own = await getOwnVault(userId);
  if (!own || own.envelope.version !== version) return false;
  // A tie-break loser at the same version is not custody of OUR shell.
  if (signature && signature !== own.envelope.signature) return false;
  const acks = await getCustodyAcks(userId);
  const fresh: CustodyAcks = acks.version === version ? acks : { version, peers: {} };
  const isNew = !fresh.peers[peerId];
  fresh.peers[peerId] = { at: Date.now(), ...(name ? { name } : {}) };
  await put("meta", { k: ACKS_KEY(userId), v: fresh });
  announce(userId);
  return isNew;
}

export async function getHeldVault(userId: string): Promise<RecoveryVaultEnvelope | null> {
  try {
    return (await get<MetaRow<HeldRecord>>("meta", HELD_KEY(userId)))?.v.envelope ?? null;
  } catch {
    return null;
  }
}

async function readIndex(): Promise<Record<string, number>> {
  try {
    return (await get<MetaRow<Record<string, number>>>("meta", HELD_INDEX_KEY))?.v ?? {};
  } catch {
    return {};
  }
}

/**
 * Hold a peer's envelope if it verifies and supersedes ours.
 * Returns true when the envelope is now held (including an equal version
 * already held, so the sender still gets an ack).
 */
export async function holdVault(value: unknown, fromPeer: string): Promise<boolean> {
  if (!(await verifyRecoveryVault(value))) return false;
  // Serialize index read → evict → write so concurrent stores cannot drop
  // index entries and escape the MAX_HELD_VAULTS cap.
  const run = custodyQueue.then(() => holdVerifiedVault(value as RecoveryVaultEnvelope, fromPeer));
  custodyQueue = run.catch(() => false);
  return run;
}

let custodyQueue: Promise<unknown> = Promise.resolve();

async function holdVerifiedVault(envelope: RecoveryVaultEnvelope, fromPeer: string): Promise<boolean> {
  const held = await getHeldVault(envelope.userId);
  if (sameEnvelope(held, envelope)) return true;
  if (!supersedes(envelope, held)) return false;

  const index = await readIndex();
  index[envelope.userId] = Date.now();
  const ids = Object.keys(index);
  if (ids.length > MAX_HELD_VAULTS) {
    const evict = ids.sort((a, b) => index[a] - index[b]).slice(0, ids.length - MAX_HELD_VAULTS);
    for (const id of evict) {
      delete index[id];
      try { await remove("meta", HELD_KEY(id)); } catch { /* ignore */ }
    }
    if (!index[envelope.userId]) return false;
  }
  const record: HeldRecord = { envelope, receivedAt: Date.now(), fromPeer };
  await put("meta", { k: HELD_KEY(envelope.userId), v: record });
  await put("meta", { k: HELD_INDEX_KEY, v: index });
  return true;
}

/** Highest verified envelope this device knows for a userId (own or held). */
export async function bestKnownVault(userId: string): Promise<RecoveryVaultEnvelope | null> {
  const own = (await getOwnVault(userId))?.envelope ?? null;
  const held = await getHeldVault(userId);
  const candidates = [own, held].filter((e): e is RecoveryVaultEnvelope => !!e);
  candidates.sort((a, b) => (supersedes(a, b) ? -1 : supersedes(b, a) ? 1 : 0));
  for (const c of candidates) if (await verifyRecoveryVault(c)) return c;
  return null;
}

// ── Sealing / rotation ─────────────────────────────────────────────────

/** Genesis v1: sealed in the background at signup with the signup password. */
export async function sealGenesisVault(privateKey: string, user: VaultProfile, signupPassword: string): Promise<OwnVaultRecord> {
  const envelope = await sealRecoveryVault({ privateKey, user, version: 1, passphrase: signupPassword });
  const record = { envelope, genesisDefault: true };
  await saveOwnVault(record);
  return record;
}

/**
 * Accounts created before sovereign recovery have no vault. The first time
 * the account password is entered (it is only ever in memory here), seal the
 * genesis shell with it, exactly as signup does, and replicate it.
 * Returns null when a vault already exists.
 */
export async function ensureGenesisVault(privateKey: string, user: VaultProfile, accountPassword: string): Promise<OwnVaultRecord | null> {
  if (await bestKnownVault(user.id)) return null;
  const record = await sealGenesisVault(privateKey, user, accountPassword);
  pushOwnVaultToAll(user.id);
  return record;
}

/**
 * While the vault is still the genesis default (sealed with the account
 * password), a local password change re-seals it under the new password so
 * "v1 = your account password" stays true. A separately wrapped shell is
 * never touched by a local password change.
 */
export async function followPasswordChange(privateKey: string, user: VaultProfile, newAccountPassword: string): Promise<OwnVaultRecord | null> {
  const own = await getOwnVault(user.id);
  if (!own?.genesisDefault) return null;
  const record = await rotateRecoveryShell(privateKey, user, newAccountPassword);
  const kept = { ...record, genesisDefault: true };
  await put("meta", { k: OWN_KEY(user.id), v: kept });
  announce(user.id);
  return kept;
}

/**
 * Wrap a new outer shell at v(N+1). The previous envelope is replaced locally
 * and the new one is pushed to every connected peer, which overwrite theirs.
 */
export async function rotateRecoveryShell(privateKey: string, user: VaultProfile, newPassphrase: string): Promise<OwnVaultRecord> {
  // Another device of this identity may already have rotated: allocate above
  // the highest verified shell we know of, own or held.
  const known = await bestKnownVault(user.id);
  const version = (known?.version ?? 0) + 1;
  const envelope = await sealRecoveryVault({ privateKey, user, version, passphrase: newPassphrase });
  const record = { envelope, genesisDefault: false };
  await saveOwnVault(record);
  pushOwnVaultToAll(user.id);
  return record;
}

/** Install a vault restored on a new device as this device's own record. */
export async function adoptRestoredVault(envelope: RecoveryVaultEnvelope): Promise<void> {
  if (!(await verifyRecoveryVault(envelope))) throw new Error("Refusing to adopt an unverified vault.");
  const existing = await getOwnVault(envelope.userId);
  if (existing && !supersedes(envelope, existing.envelope)) return;
  await saveOwnVault({ envelope, genesisDefault: envelope.version === 1 && (existing?.genesisDefault ?? true) });
}

// ── Wire protocol ──────────────────────────────────────────────────────

export type VaultMessage =
  | { kind: "store"; envelope: RecoveryVaultEnvelope }
  | { kind: "ack"; userId: string; version: number; signature?: string }
  | { kind: "query"; userId: string; requestId: string }
  | { kind: "response"; requestId: string; envelope: RecoveryVaultEnvelope | null };

export interface VaultTransport {
  send(channel: string, peerId: string, payload: unknown): Promise<boolean> | boolean;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
  getConnectedPeerIds(): string[];
  onPeersChange?(handler: (peers: Array<{ peerId: string }>) => void): () => void;
}

export interface CustodyAckEvent {
  userId: string;
  version: number;
  peerId: string;
  peerName?: string;
  firstForVersion: boolean;
}

let transport: VaultTransport | null = null;
let activeUserId: () => string | null = () => null;
let peerName: (peerId: string) => string | undefined = () => undefined;
const pendingQueries = new Map<string, (env: RecoveryVaultEnvelope | null) => void>();
const ackListeners = new Set<(event: CustodyAckEvent) => void>();

/** Phase 6 hook: called when a peer confirms it holds our current vault. */
export function onCustodyAck(listener: (event: CustodyAckEvent) => void): () => void {
  ackListeners.add(listener);
  return () => ackListeners.delete(listener);
}

function send(peerId: string, msg: VaultMessage): void {
  if (!transport) return;
  try { void transport.send(VAULT_CHANNEL, peerId, msg); } catch { /* peer gone */ }
}

async function pushOwnVault(peerId: string, userId: string): Promise<void> {
  const own = await getOwnVault(userId);
  if (own) send(peerId, { kind: "store", envelope: own.envelope });
}

export function pushOwnVaultToAll(userId?: string | null): number {
  const owner = userId ?? activeUserId();
  if (!transport || !owner) return 0;
  const peers = transport.getConnectedPeerIds();
  for (const peerId of peers) void pushOwnVault(peerId, owner);
  return peers.length;
}

export async function handleVaultMessage(fromPeer: string, payload: unknown): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  const msg = payload as VaultMessage;
  switch (msg.kind) {
    case "store": {
      // Our own identity rotated on another device: adopt the newer shell.
      if (msg.envelope?.userId && msg.envelope.userId === activeUserId()) {
        try { await adoptRestoredVault(msg.envelope); } catch { /* unverified: ignored */ }
      }
      if (await holdVault(msg.envelope, fromPeer)) {
        send(fromPeer, { kind: "ack", userId: msg.envelope.userId, version: msg.envelope.version, signature: msg.envelope.signature });
        return;
      }
      // We hold a shell that wins over the one offered (newer, or the
      // tie-break winner): hand it back so the sender converges too.
      if (msg.envelope && typeof msg.envelope.userId === "string") {
        const better = await bestKnownVault(msg.envelope.userId);
        if (better && !sameEnvelope(better, msg.envelope) && supersedes(better, msg.envelope)) {
          send(fromPeer, { kind: "store", envelope: better });
        }
      }
      return;
    }
    case "ack": {
      if (typeof msg.userId !== "string" || typeof msg.version !== "number") return;
      if (msg.userId !== activeUserId()) return;
      const name = peerName(fromPeer);
      const isNew = await recordAck(msg.userId, msg.version, fromPeer, name, typeof msg.signature === "string" ? msg.signature : undefined);
      if (!isNew) return;
      const own = await getOwnVault(msg.userId);
      const event: CustodyAckEvent = {
        userId: msg.userId,
        version: msg.version,
        peerId: fromPeer,
        peerName: name,
        firstForVersion: Object.keys((await getCustodyAcks(msg.userId)).peers).length === 1 && own?.envelope.version === msg.version,
      };
      for (const l of ackListeners) {
        try { l(event); } catch { /* listener error */ }
      }
      return;
    }
    case "query": {
      if (typeof msg.userId !== "string" || typeof msg.requestId !== "string") return;
      send(fromPeer, { kind: "response", requestId: msg.requestId, envelope: await bestKnownVault(msg.userId) });
      return;
    }
    case "response": {
      const resolve = typeof msg.requestId === "string" ? pendingQueries.get(msg.requestId) : undefined;
      if (!resolve) return;
      pendingQueries.delete(msg.requestId);
      resolve(msg.envelope && (await verifyRecoveryVault(msg.envelope)) ? msg.envelope : null);
      return;
    }
    default:
      return;
  }
}

/**
 * Ask one connected peer for a user's highest verified envelope.
 * Resolves null on timeout, refusal or an envelope that fails verification.
 */
export function queryVaultFromPeer(peerId: string, userId: string, timeoutMs = 15_000): Promise<RecoveryVaultEnvelope | null> {
  if (!transport) return Promise.resolve(null);
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingQueries.delete(requestId);
      resolve(null);
    }, timeoutMs);
    pendingQueries.set(requestId, (env) => {
      clearTimeout(timer);
      resolve(env);
    });
    send(peerId, { kind: "query", userId, requestId });
  });
}

/**
 * Attach the custody protocol to a mesh. Pushes the active user's vault to
 * each newly connected peer so replication is opportunistic, never blocking.
 */
export function startVaultCustody(options: {
  transport: VaultTransport;
  getActiveUserId: () => string | null;
  getPeerName?: (peerId: string) => string | undefined;
}): () => void {
  transport = options.transport;
  activeUserId = options.getActiveUserId;
  peerName = options.getPeerName ?? (() => undefined);
  const unsubMessage = transport.onMessage(VAULT_CHANNEL, (peerId, payload) => {
    void handleVaultMessage(peerId, payload).catch(() => { /* malformed */ });
  });
  const seen = new Set<string>();
  const unsubPeers = transport.onPeersChange?.((peers) => {
    const owner = activeUserId();
    const now = new Set(peers.map((p) => p.peerId));
    for (const id of Array.from(seen)) if (!now.has(id)) seen.delete(id);
    for (const id of now) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (owner) void pushOwnVault(id, owner);
    }
  });
  const onLogin = () => { pushOwnVaultToAll(); };
  try { window.addEventListener("user-login", onLogin); } catch { /* non-browser */ }
  return () => {
    unsubMessage();
    unsubPeers?.();
    try { window.removeEventListener("user-login", onLogin); } catch { /* ignore */ }
    transport = null;
  };
}

export function isVaultCustodyAttached(): boolean {
  return transport !== null;
}
