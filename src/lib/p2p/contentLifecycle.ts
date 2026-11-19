/**
 * Content lifecycle — signed tombstones, the 15-day fadeout and favorites.
 *
 *  1. Tombstones (deliberate deletion). A post or account tombstone is signed
 *     with the author's IDENTITY key (P-256, the same key the userId is hashed
 *     from), so any peer can check `computeUserId(signerPublicKey) === authorId`
 *     with no lookup. The device-local Ed25519 key that signs posts is not
 *     bound to the author and is lost on a cache wipe, so it cannot authorise
 *     deletion.
 *  2. Anti-resurrection. Tombstones are kept for TOMBSTONE_RETENTION_MS
 *     (30 days, longer than the fadeout window). Incoming content that matches
 *     one is refused and the sender is answered with the tombstone.
 *  3. Fadeout (passive decay). Another author's post fades from this device
 *     when that author has not been seen for FADEOUT_WINDOW_MS. "Seen" is the
 *     newest timestamp the author themselves produced (a post's createdAt or
 *     editedAt, a live profile exchange, or a peer's hint of either), never
 *     the moment a relay re-sends old content, so relays cannot keep each
 *     other's copies alive forever.
 *  4. Favorites. A post this device favorites never fades. Favorites are
 *     device-local records, not a field on the post, so they never leave the
 *     device and incoming sync cannot overwrite them. Tombstones still win.
 */
import { get, getAll, put, remove, type Chunk, type Manifest } from "../store";
import type { Comment, Post } from "@/types";
import { arrayBufferToBase64, base64ToArrayBuffer, computeUserId } from "../crypto";
import { canonicalJsonBytes } from "../utils/canonicalJson";
import { getCachedPrivateKey, getCurrentUser, getStoredAccounts } from "../auth";
import { isPostUnsupported } from "../content/unsupportedPostsStore";

const DAY_MS = 24 * 60 * 60 * 1000;
export const FADEOUT_WINDOW_MS = 15 * DAY_MS;
export const TOMBSTONE_RETENTION_MS = 30 * DAY_MS;
/** Tombstones dated further than this in the future are refused. */
export const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
/** Presence is persisted at most this often per author (memory is always current). */
const PRESENCE_PERSIST_STEP_MS = 60 * 60 * 1000;
/** Most presence hints shared with one peer. */
const PRESENCE_HINT_CAP = 500;

export const TOMBSTONE_STORE = "contentTombstones";
export const PRESENCE_STORE = "authorPresence";
export const FAVORITES_STORE = "postFavorites";

export const FAVORITES_EVENT = "post-favorites-updated";

// ── Types ───────────────────────────────────────────────────────────────

export interface PostTombstone {
  type: "post_tombstone";
  postId: string;
  authorId: string;
  deletedAt: string;
  signerPublicKey: string;
  signature: string;
}

export interface AccountTombstone {
  type: "account_tombstone";
  authorId: string;
  deletedAt: string;
  signerPublicKey: string;
  signature: string;
}

export type ContentTombstone = PostTombstone | AccountTombstone;
export type UnsignedTombstone =
  | Omit<PostTombstone, "signature" | "signerPublicKey">
  | Omit<AccountTombstone, "signature" | "signerPublicKey">;

export interface TombstoneRecord {
  /** `post:<authorId>:<postId>` or `account:<authorId>` */
  id: string;
  kind: "post" | "account";
  postId?: string;
  authorId: string;
  deletedAt: string;
  expiresAt: number;
  /** The signed tombstone, kept so it can be forwarded to peers. */
  tombstone?: ContentTombstone;
  /** Our own deletion, made while the identity key was locked. Signed later. */
  pendingSignature?: boolean;
}

export interface AuthorPresence {
  authorId: string;
  lastSeenAt: number;
}

export interface PostFavorite {
  postId: string;
  favoritedAt: string;
}

// ── Signing ─────────────────────────────────────────────────────────────

function signingPayload(t: UnsignedTombstone): Uint8Array {
  return canonicalJsonBytes(
    t.type === "post_tombstone"
      ? { type: t.type, postId: t.postId, authorId: t.authorId, deletedAt: t.deletedAt }
      : { type: t.type, authorId: t.authorId, deletedAt: t.deletedAt },
  );
}

function bytes(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

/** Sign with the identity key (base64 PKCS#8 P-256) and its public key (base64). */
export async function signTombstone(
  unsigned: UnsignedTombstone,
  privateKey: string,
  publicKey: string,
): Promise<ContentTombstone> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    base64ToArrayBuffer(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    bytes(signingPayload(unsigned)),
  );
  return { ...unsigned, signerPublicKey: publicKey, signature: arrayBufferToBase64(signature) } as ContentTombstone;
}

async function importVerifyKey(publicKey: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(publicKey);
  try {
    return await crypto.subtle.importKey("spki", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    // Accounts recovered from a private key store the raw point form.
    return crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }
}

function isNonEmptyString(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** Shape check only; does not verify the signature. */
export function isTombstoneShape(value: unknown): value is ContentTombstone {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  if (t.type !== "post_tombstone" && t.type !== "account_tombstone") return false;
  if (t.type === "post_tombstone" && !isNonEmptyString(t.postId)) return false;
  return (
    isNonEmptyString(t.authorId, 128) &&
    isNonEmptyString(t.deletedAt, 64) &&
    isNonEmptyString(t.signerPublicKey, 1024) &&
    isNonEmptyString(t.signature, 1024)
  );
}

/**
 * A tombstone is valid when its key hashes to the author's id, the signature
 * covers the payload, and its date is neither in the future nor past retention.
 */
export async function verifyTombstone(value: unknown, now = Date.now()): Promise<boolean> {
  if (!isTombstoneShape(value)) return false;
  const deletedMs = Date.parse(value.deletedAt);
  if (!Number.isFinite(deletedMs)) return false;
  if (deletedMs > now + MAX_CLOCK_SKEW_MS) return false;
  if (deletedMs + TOMBSTONE_RETENTION_MS <= now) return false;
  try {
    if ((await computeUserId(value.signerPublicKey)) !== value.authorId) return false;
    const key = await importVerifyKey(value.signerPublicKey);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      base64ToArrayBuffer(value.signature),
      bytes(signingPayload(value)),
    );
  } catch {
    return false;
  }
}

// ── In-memory state ─────────────────────────────────────────────────────

const postTombstones = new Map<string, TombstoneRecord>();
const accountTombstones = new Map<string, TombstoneRecord>();
const presence = new Map<string, number>();
const presencePersisted = new Map<string, number>();
let loadPromise: Promise<void> | null = null;

/**
 * Post tombstones are keyed by author AND post id, so a tombstone someone
 * signs for another author's post id can never displace the real author's.
 */
function postKey(authorId: string, postId: string): string {
  return `${authorId}:${postId}`;
}

function recordKey(t: { type: ContentTombstone["type"]; postId?: string; authorId: string }): string {
  return t.type === "post_tombstone" ? `post:${postKey(t.authorId, t.postId ?? "")}` : `account:${t.authorId}`;
}

function cacheRecord(record: TombstoneRecord): void {
  if (record.kind === "post" && record.postId) postTombstones.set(postKey(record.authorId, record.postId), record);
  if (record.kind === "account") {
    accountTombstones.set(record.authorId, record);
    if (record.tombstone) notifyAccountRetired(record.authorId);
  }
}

// ── Account retirement listeners ────────────────────────────────────────

const accountRetiredListeners = new Set<(authorId: string) => void>();

/**
 * Called once a signed account tombstone is known for an author (loaded,
 * received or issued here). Recovery custody uses it to drop the retired
 * identity's vault so stale shells leave the mesh.
 */
export function onAccountRetired(listener: (authorId: string) => void): () => void {
  accountRetiredListeners.add(listener);
  return () => accountRetiredListeners.delete(listener);
}

function notifyAccountRetired(authorId: string): void {
  for (const listener of accountRetiredListeners) {
    try { listener(authorId); } catch { /* listener errors never block lifecycle */ }
  }
}

/** True while a signed account tombstone for this author is live. */
export async function isAccountRetired(authorId: string, now = Date.now()): Promise<boolean> {
  await ensureLifecycleLoaded();
  const record = accountTombstones.get(authorId);
  return !!record?.tombstone && isLive(record, now);
}

function uncacheRecord(record: TombstoneRecord): void {
  if (record.kind === "post" && record.postId) postTombstones.delete(postKey(record.authorId, record.postId));
  if (record.kind === "account") accountTombstones.delete(record.authorId);
}

/** Load tombstones and presence from storage once. Safe to call repeatedly. */
export function ensureLifecycleLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const now = Date.now();
      try {
        const records = await getAll<TombstoneRecord>(TOMBSTONE_STORE);
        for (const record of records) {
          if (record.expiresAt <= now) {
            await remove(TOMBSTONE_STORE, record.id).catch(() => undefined);
            continue;
          }
          cacheRecord(record);
        }
      } catch (error) {
        console.warn("[Lifecycle] Failed to load tombstones", error);
      }
      try {
        const rows = await getAll<AuthorPresence>(PRESENCE_STORE);
        for (const row of rows) {
          if (!row?.authorId || !Number.isFinite(row.lastSeenAt)) continue;
          if ((presence.get(row.authorId) ?? 0) < row.lastSeenAt) presence.set(row.authorId, row.lastSeenAt);
          presencePersisted.set(row.authorId, row.lastSeenAt);
        }
      } catch (error) {
        console.warn("[Lifecycle] Failed to load author presence", error);
      }
    })();
  }
  return loadPromise;
}

/** Test hook: forget all in-memory state. */
export function resetLifecycleForTests(): void {
  postTombstones.clear();
  accountTombstones.clear();
  presence.clear();
  presencePersisted.clear();
  loadPromise = null;
  transports.clear();
  purgeListeners.clear();
  sweepStarted = false;
}

function isLive(record: TombstoneRecord | undefined, now = Date.now()): record is TombstoneRecord {
  return !!record && record.expiresAt > now;
}

/**
 * True when this post must not be stored: a live post tombstone signed by
 * this author for this id, or a live account tombstone for the author.
 * Synchronous so the mesh hot path can use it; call ensureLifecycleLoaded()
 * first at startup.
 */
export function isPostTombstoned(postId: string | undefined, authorId: string | undefined): boolean {
  if (!authorId) return false;
  const now = Date.now();
  if (isLive(accountTombstones.get(authorId), now)) return true;
  return !!postId && isLive(postTombstones.get(postKey(authorId, postId)), now);
}

/** Signed tombstones that explain why these items were refused (to answer the sender). */
export function tombstonesFor(items: Array<{ id?: string; author?: string }>): ContentTombstone[] {
  const now = Date.now();
  const out = new Map<string, ContentTombstone>();
  for (const item of items) {
    const account = item.author ? accountTombstones.get(item.author) : undefined;
    if (isLive(account, now) && account.tombstone) out.set(account.id, account.tombstone);
    const post = item.id && item.author ? postTombstones.get(postKey(item.author, item.id)) : undefined;
    if (isLive(post, now) && post.tombstone) {
      out.set(post.id, post.tombstone);
    }
  }
  return [...out.values()];
}

/** Every live, signed tombstone this device knows (sent to a peer on connect). */
export function getActiveTombstones(): ContentTombstone[] {
  const now = Date.now();
  const out: ContentTombstone[] = [];
  for (const record of [...accountTombstones.values(), ...postTombstones.values()]) {
    if (isLive(record, now) && record.tombstone) out.push(record.tombstone);
  }
  return out;
}

// ── Transports and purge listeners ──────────────────────────────────────

/** Sends tombstones to connected peers, skipping one; returns peers reached. */
export type TombstoneTransport = (tombstones: ContentTombstone[], excludePeerId?: string) => number;
export type PurgeListener = (postIds: string[]) => void;

const transports = new Set<TombstoneTransport>();
const purgeListeners = new Set<PurgeListener>();

export function registerTombstoneTransport(transport: TombstoneTransport): () => void {
  transports.add(transport);
  return () => transports.delete(transport);
}

/** Called after posts are purged so in-memory caches (e.g. the mesh content store) drop them too. */
export function onContentPurged(listener: PurgeListener): () => void {
  purgeListeners.add(listener);
  return () => purgeListeners.delete(listener);
}

export function broadcastTombstones(tombstones: ContentTombstone[], excludePeerId?: string): number {
  if (tombstones.length === 0) return 0;
  let reached = 0;
  for (const transport of transports) {
    try {
      reached += transport(tombstones, excludePeerId);
    } catch (error) {
      console.warn("[Lifecycle] Tombstone transport failed", error);
    }
  }
  return reached;
}

// ── Purging ─────────────────────────────────────────────────────────────

function notifyPostsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
}

async function localAccountIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const current = getCurrentUser();
  if (current?.id) ids.add(current.id);
  try {
    for (const account of await getStoredAccounts()) ids.add(account.id);
  } catch {
    /* current user is enough */
  }
  return ids;
}

/**
 * Remove posts, their comments, and attached files that nothing else uses.
 * Files attached to posts by an account on this device are never released
 * (local uploads carry no `owner` field, so authorship is the reliable
 * signal), nor are files anchored to a coin (`_coinId`) or owned locally.
 * Returns the purged post and comment ids.
 */
export async function purgePosts(posts: Post[]): Promise<string[]> {
  if (posts.length === 0) return [];
  const ids = new Set(posts.map((p) => p.id));
  const purgedIds: string[] = [...ids];

  for (const post of posts) {
    await remove("posts", post.id).catch(() => undefined);
  }

  try {
    const comments = await getAll<Comment>("comments");
    for (const comment of comments) {
      if (!ids.has(comment.postId)) continue;
      await remove("comments", comment.id).catch(() => undefined);
      purgedIds.push(comment.id);
    }
  } catch {
    /* comments store optional */
  }

  const owners = await localAccountIds();
  const candidateManifests = new Set<string>();
  for (const post of posts) {
    if (owners.has(post.author)) continue;
    for (const id of post.manifestIds ?? []) if (id) candidateManifests.add(id);
  }
  if (candidateManifests.size > 0) {
    try {
      const remaining = (await getAll<Post>("posts")).filter((p) => !ids.has(p.id));
      for (const p of remaining) for (const id of p.manifestIds ?? []) candidateManifests.delete(id);
      const manifests = await getAll<Manifest & { _coinId?: string }>("manifests");
      const doomed = manifests.filter(
        (m) => candidateManifests.has(m.fileId) && !m._coinId && !(m.owner && owners.has(m.owner)),
      );
      const doomedIds = new Set(doomed.map((m) => m.fileId));
      const keptChunks = new Set<string>();
      for (const m of manifests) if (!doomedIds.has(m.fileId)) for (const c of m.chunks ?? []) keptChunks.add(c);
      for (const m of doomed) {
        for (const chunkRef of m.chunks ?? []) {
          if (!keptChunks.has(chunkRef)) await remove("chunks", chunkRef).catch(() => undefined);
        }
        await remove("manifests", m.fileId).catch(() => undefined);
        await remove("replicas", m.fileId).catch(() => undefined);
      }
    } catch (error) {
      console.warn("[Lifecycle] Failed to release attached files", error);
    }
  }

  for (const listener of purgeListeners) {
    try {
      listener(purgedIds);
    } catch {
      /* listener errors never block a purge */
    }
  }
  notifyPostsChanged();
  return [...ids];
}

async function applyRecord(record: TombstoneRecord): Promise<string[]> {
  if (record.kind === "post" && record.postId) {
    const post = await get<Post>("posts", record.postId);
    if (!post || post.author !== record.authorId) return [];
    return purgePosts([post]);
  }
  const all = await getAll<Post>("posts");
  const purged = await purgePosts(all.filter((p) => p.author === record.authorId));
  const commentIds: string[] = [];
  try {
    const comments = await getAll<Comment>("comments");
    for (const comment of comments) {
      if (comment.author !== record.authorId) continue;
      await remove("comments", comment.id).catch(() => undefined);
      commentIds.push(comment.id);
    }
  } catch {
    /* comments store optional */
  }
  if (commentIds.length > 0) {
    for (const listener of purgeListeners) {
      try {
        listener(commentIds);
      } catch {
        /* listener errors never block a purge */
      }
    }
  }
  return purged;
}

function recordFromTombstone(t: ContentTombstone): TombstoneRecord {
  return {
    id: recordKey(t),
    kind: t.type === "post_tombstone" ? "post" : "account",
    ...(t.type === "post_tombstone" ? { postId: t.postId } : {}),
    authorId: t.authorId,
    deletedAt: t.deletedAt,
    expiresAt: Date.parse(t.deletedAt) + TOMBSTONE_RETENTION_MS,
    tombstone: t,
  };
}

/**
 * Accept tombstones from a peer: verify, store, purge, and forward the new
 * ones to every other peer. Returns the tombstones that were new here.
 */
export async function receiveTombstones(list: unknown, fromPeerId?: string): Promise<ContentTombstone[]> {
  if (!Array.isArray(list) || list.length === 0) return [];
  await ensureLifecycleLoaded();
  const accepted: ContentTombstone[] = [];
  for (const candidate of list.slice(0, 1000)) {
    if (!isTombstoneShape(candidate)) continue;
    const key = recordKey(candidate);
    const known = candidate.type === "post_tombstone"
      ? postTombstones.get(postKey(candidate.authorId, candidate.postId))
      : accountTombstones.get(candidate.authorId);
    // Already holding a signed copy at least this new: nothing to do, and not forwarding stops gossip loops.
    if (known?.id === key && known.tombstone && Date.parse(known.deletedAt) >= Date.parse(candidate.deletedAt)) continue;
    if (!(await verifyTombstone(candidate))) continue;
    const record = recordFromTombstone(candidate);
    await put(TOMBSTONE_STORE, record);
    cacheRecord(record);
    await applyRecord(record);
    accepted.push(candidate);
  }
  if (accepted.length > 0) broadcastTombstones(accepted, fromPeerId);
  return accepted;
}

// ── Our own deletions ───────────────────────────────────────────────────

async function signAsCurrentUser(unsigned: UnsignedTombstone, privateKey?: string | null): Promise<ContentTombstone | null> {
  const user = getCurrentUser();
  if (!user?.publicKey || user.id !== unsigned.authorId) return null;
  const key = privateKey ?? (await getCachedPrivateKey().catch(() => null));
  if (!key) return null;
  try {
    const signed = await signTombstone(unsigned, key, user.publicKey);
    return (await verifyTombstone(signed)) ? signed : null;
  } catch (error) {
    console.warn("[Lifecycle] Could not sign tombstone", error);
    return null;
  }
}

export interface TombstoneResult {
  signed: boolean;
  peersReached: number;
}

/**
 * Record, purge and broadcast a tombstone for the current user's own post.
 * If the identity key is locked, the post is still removed here and the
 * tombstone waits until flushPendingTombstones() can sign it.
 */
export async function tombstoneOwnPost(post: Post): Promise<TombstoneResult> {
  await ensureLifecycleLoaded();
  const deletedAt = new Date().toISOString();
  const unsigned: UnsignedTombstone = { type: "post_tombstone", postId: post.id, authorId: post.author, deletedAt };
  const signed = post._localOnly ? null : await signAsCurrentUser(unsigned);
  const record: TombstoneRecord = {
    id: recordKey(unsigned),
    kind: "post",
    postId: post.id,
    authorId: post.author,
    deletedAt,
    expiresAt: Date.parse(deletedAt) + TOMBSTONE_RETENTION_MS,
    ...(signed ? { tombstone: signed } : {}),
    ...(!signed && !post._localOnly ? { pendingSignature: true } : {}),
  };
  await put(TOMBSTONE_STORE, record);
  cacheRecord(record);
  await purgePosts([post]);
  return { signed: !!signed, peersReached: signed ? broadcastTombstones([signed]) : 0 };
}

/**
 * Sign and broadcast an account tombstone for the current user. Requires the
 * identity key; pass it explicitly when the caller has just unlocked it.
 * Returns null when no key is available.
 */
export async function issueAccountTombstone(privateKey?: string | null): Promise<TombstoneResult | null> {
  const user = getCurrentUser();
  if (!user) return null;
  await ensureLifecycleLoaded();
  const deletedAt = new Date().toISOString();
  const signed = await signAsCurrentUser({ type: "account_tombstone", authorId: user.id, deletedAt }, privateKey);
  if (!signed) return null;
  const record = recordFromTombstone(signed);
  await put(TOMBSTONE_STORE, record).catch(() => undefined);
  cacheRecord(record);
  return { signed: true, peersReached: broadcastTombstones([signed]) };
}

/** Sign our own deletions that were made while the key was locked, then send them. */
export async function flushPendingTombstones(): Promise<number> {
  await ensureLifecycleLoaded();
  const user = getCurrentUser();
  if (!user) return 0;
  const pending = [...postTombstones.values()].filter((r) => r.pendingSignature && r.authorId === user.id && isLive(r));
  if (pending.length === 0) return 0;
  const key = await getCachedPrivateKey().catch(() => null);
  if (!key) return 0;
  const signedList: ContentTombstone[] = [];
  for (const record of pending) {
    const signed = await signAsCurrentUser(
      { type: "post_tombstone", postId: record.postId ?? "", authorId: record.authorId, deletedAt: record.deletedAt },
      key,
    );
    if (!signed) continue;
    const next: TombstoneRecord = { ...record, tombstone: signed };
    delete next.pendingSignature;
    await put(TOMBSTONE_STORE, next);
    cacheRecord(next);
    signedList.push(signed);
  }
  if (signedList.length > 0) broadcastTombstones(signedList);
  return signedList.length;
}

// ── Presence ────────────────────────────────────────────────────────────

/** Record that an author was active at `atMs` (clamped to now). Max-merge, so hints never move time backwards. */
export function noteAuthorSeen(authorId: string | undefined, atMs: number = Date.now()): void {
  if (!authorId || !Number.isFinite(atMs) || atMs <= 0) return;
  const at = Math.min(atMs, Date.now());
  if ((presence.get(authorId) ?? 0) >= at) return;
  presence.set(authorId, at);
  const persisted = presencePersisted.get(authorId) ?? 0;
  if (at - persisted >= PRESENCE_PERSIST_STEP_MS) {
    presencePersisted.set(authorId, at);
    void put<AuthorPresence>(PRESENCE_STORE, { authorId, lastSeenAt: at }).catch(() => undefined);
  }
}

/** The newest moment the author themselves produced this post (created or edited). */
export function noteAuthorActivityFromPost(post: { author?: unknown; createdAt?: unknown; editedAt?: unknown }): void {
  if (typeof post.author !== "string") return;
  const created = typeof post.createdAt === "string" ? Date.parse(post.createdAt) : NaN;
  const edited = typeof post.editedAt === "string" ? Date.parse(post.editedAt) : NaN;
  const at = Math.max(Number.isFinite(created) ? created : 0, Number.isFinite(edited) ? edited : 0);
  if (at > 0) noteAuthorSeen(post.author, at);
}

export function getAuthorLastSeen(authorId: string): number | undefined {
  return presence.get(authorId);
}

/** Recent presence observations to share with a peer (the timestamps, never "now"). */
export function getPresenceHints(now = Date.now()): Record<string, number> {
  const fresh = [...presence.entries()]
    .filter(([, at]) => now - at <= FADEOUT_WINDOW_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, PRESENCE_HINT_CAP);
  return Object.fromEntries(fresh);
}

export function receivePresenceHints(hints: unknown): void {
  if (!hints || typeof hints !== "object") return;
  let n = 0;
  for (const [authorId, at] of Object.entries(hints as Record<string, unknown>)) {
    if (++n > PRESENCE_HINT_CAP) break;
    if (typeof at === "number" && authorId.length <= 128) noteAuthorSeen(authorId, at);
  }
}

// ── Favorites ───────────────────────────────────────────────────────────

export async function isPostFavorited(postId: string): Promise<boolean> {
  try {
    return !!(await get<PostFavorite>(FAVORITES_STORE, postId));
  } catch {
    return false;
  }
}

export async function setPostFavorited(postId: string, favorited: boolean): Promise<void> {
  if (favorited) await put<PostFavorite>(FAVORITES_STORE, { postId, favoritedAt: new Date().toISOString() });
  else await remove(FAVORITES_STORE, postId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FAVORITES_EVENT, { detail: { postId, favorited } }));
  }
}

async function favoriteIds(): Promise<Set<string>> {
  try {
    return new Set((await getAll<PostFavorite>(FAVORITES_STORE)).map((f) => f.postId));
  } catch {
    return new Set();
  }
}

// ── Fadeout ─────────────────────────────────────────────────────────────

function isFaded(authorId: string, now: number): boolean {
  const lastSeen = presence.get(authorId);
  return lastSeen !== undefined && now - lastSeen > FADEOUT_WINDOW_MS;
}

/**
 * Should an incoming synced post be stored? No when it is tombstoned, or when
 * its author has faded and this device has not favorited it (stops peers
 * from re-seeding content that already rotted out here).
 */
export async function shouldAcceptIncomingPost(post: { id?: string; author?: string; createdAt?: unknown; editedAt?: unknown }): Promise<boolean> {
  await ensureLifecycleLoaded();
  if (isPostTombstoned(post.id, post.author)) return false;
  // This node stopped supporting the post: drop incoming copies.
  if (isPostUnsupported(post.id)) return false;
  if (!post.author) return true;
  noteAuthorActivityFromPost(post);
  if (!isFaded(post.author, Date.now())) return true;
  if ((await localAccountIds()).has(post.author)) return true;
  return post.id ? isPostFavorited(post.id) : false;
}

/**
 * Should an incoming comment be stored? No when its author's account is
 * tombstoned, or its parent post was deleted by that post's author. A
 * tombstone signed by someone else for the same post id is ignored while the
 * real post is still held here.
 */
export async function shouldAcceptIncomingComment(comment: { postId?: unknown; author?: unknown }): Promise<boolean> {
  await ensureLifecycleLoaded();
  const author = typeof comment.author === "string" ? comment.author : undefined;
  if (author && isPostTombstoned(undefined, author)) return false;
  if (typeof comment.postId !== "string") return true;
  const now = Date.now();
  const matching = [...postTombstones.values()].filter((r) => r.postId === comment.postId && isLive(r, now));
  if (matching.length === 0) return true;
  const parent = await get<Post>("posts", comment.postId).catch(() => undefined);
  if (!parent) return false;
  return !matching.some((r) => r.authorId === parent.author);
}

export interface SweepResult {
  faded: string[];
  tombstoned: string[];
  expiredTombstones: number;
}

/**
 * Idle-time sweep: drop expired tombstones, purge any tombstoned leftovers,
 * and fade other authors' unfavorited posts whose author has been silent for
 * longer than the window. Authors with no presence yet (content held before
 * this feature) get a fresh grace window instead of vanishing at once.
 */
export async function sweepContentLifecycle(now = Date.now()): Promise<SweepResult> {
  await ensureLifecycleLoaded();
  let expiredTombstones = 0;
  for (const record of [...postTombstones.values(), ...accountTombstones.values()]) {
    if (record.expiresAt > now) continue;
    uncacheRecord(record);
    await remove(TOMBSTONE_STORE, record.id).catch(() => undefined);
    expiredTombstones++;
  }

  const [posts, favorites, owners] = await Promise.all([getAll<Post>("posts"), favoriteIds(), localAccountIds()]);
  const tombstoned: Post[] = [];
  const faded: Post[] = [];
  for (const post of posts) {
    if (!post?.id) continue;
    if (isPostTombstoned(post.id, post.author)) {
      tombstoned.push(post);
      continue;
    }
    // Ownership comes from this device's accounts, never the transported `_origin` flag.
    if (!post.author || owners.has(post.author)) continue;
    if (favorites.has(post.id)) continue;
    if (!presence.has(post.author)) {
      noteAuthorSeen(post.author, now);
      continue;
    }
    if (isFaded(post.author, now)) faded.push(post);
  }

  const tombstonedIds = await purgePosts(tombstoned);
  const fadedIds = await purgePosts(faded);
  if (fadedIds.length > 0) console.log(`[Lifecycle] 🍂 Faded ${fadedIds.length} post(s) from inactive authors`);
  return { faded: fadedIds, tombstoned: tombstonedIds, expiredTombstones };
}

// ── Scheduling ──────────────────────────────────────────────────────────

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;
let sweepStarted = false;

function whenIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === "function") ric(fn, { timeout: 30_000 });
  else setTimeout(fn, 0);
}

/** Load state, then sweep and flush pending tombstones in idle time. Idempotent. */
export function startContentLifecycle(): void {
  if (sweepStarted) return;
  sweepStarted = true;
  void ensureLifecycleLoaded();
  const tick = () =>
    whenIdle(() => {
      void sweepContentLifecycle().catch((error) => console.warn("[Lifecycle] Sweep failed", error));
      void flushPendingTombstones().catch(() => undefined);
    });
  setTimeout(tick, FIRST_SWEEP_DELAY_MS);
  setInterval(tick, SWEEP_INTERVAL_MS);
}
