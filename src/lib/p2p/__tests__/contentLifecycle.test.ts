import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/types";
import { computeUserId, genIdentityKeyPair } from "@/lib/crypto";

const h = vi.hoisted(() => {
  const keyPaths: Record<string, string> = {
    posts: "id",
    comments: "id",
    manifests: "fileId",
    chunks: "ref",
    replicas: "manifestId",
    contentTombstones: "id",
    authorPresence: "authorId",
    postFavorites: "postId",
  };
  const db = new Map<string, Map<string, unknown>>();
  const table = (name: string) => {
    if (!db.has(name)) db.set(name, new Map());
    return db.get(name)!;
  };
  const auth = {
    user: null as null | { id: string; publicKey: string; username: string },
    privateKey: null as string | null,
  };
  return { keyPaths, db, table, auth };
});

vi.mock("@/lib/store", () => ({
  get: async (store: string, key: string) => h.table(store).get(key),
  getAll: async (store: string) => [...h.table(store).values()],
  put: async (store: string, value: Record<string, unknown>) => {
    h.table(store).set(String(value[h.keyPaths[store]]), structuredClone(value));
  },
  remove: async (store: string, key: string) => {
    h.table(store).delete(key);
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: () => h.auth.user,
  getCachedPrivateKey: async () => h.auth.privateKey,
  getStoredAccounts: async () => (h.auth.user ? [h.auth.user] : []),
}));

import * as lc from "../contentLifecycle";

const DAY = 24 * 60 * 60 * 1000;

interface Identity {
  id: string;
  publicKey: string;
  privateKey: string;
}

async function makeIdentity(): Promise<Identity> {
  // The real account path: an ECDH P-256 identity key, userId hashed from its public key.
  const keys = await genIdentityKeyPair();
  return { id: await computeUserId(keys.publicKey), ...keys };
}

function post(id: string, author: string, extra: Partial<Post> = {}): Post {
  return { id, author, type: "text", content: `hello ${id}`, createdAt: new Date().toISOString(), ...extra };
}

async function seedPost(p: Post) {
  h.table("posts").set(p.id, p);
}

function signPostTombstone(who: Identity, postId: string, authorId = who.id, deletedAt = new Date().toISOString()) {
  return lc.signTombstone({ type: "post_tombstone", postId, authorId, deletedAt }, who.privateKey, who.publicKey);
}

let alice: Identity;
let eve: Identity;
let me: Identity;

beforeEach(async () => {
  h.db.clear();
  lc.resetLifecycleForTests();
  alice ??= await makeIdentity();
  eve ??= await makeIdentity();
  me ??= await makeIdentity();
  h.auth.user = { id: me.id, publicKey: me.publicKey, username: "me" };
  h.auth.privateKey = me.privateKey;
});

describe("tombstone signatures", () => {
  it("accepts a tombstone signed by the author's identity key", async () => {
    const t = await signPostTombstone(alice, "p1");
    expect(await lc.verifyTombstone(t)).toBe(true);
  });

  it("rejects a tombstone signed by someone else for the author's id", async () => {
    const forged = await signPostTombstone(eve, "p1", alice.id);
    expect(await lc.verifyTombstone(forged)).toBe(false);
  });

  it("rejects a tombstone whose payload was altered after signing", async () => {
    const t = await signPostTombstone(alice, "p1");
    expect(await lc.verifyTombstone({ ...t, postId: "p2" })).toBe(false);
  });

  it("rejects future-dated and expired tombstones", async () => {
    const future = await signPostTombstone(alice, "p1", alice.id, new Date(Date.now() + DAY).toISOString());
    const expired = await signPostTombstone(alice, "p1", alice.id, new Date(Date.now() - 31 * DAY).toISOString());
    expect(await lc.verifyTombstone(future)).toBe(false);
    expect(await lc.verifyTombstone(expired)).toBe(false);
  });
});

describe("receiving tombstones", () => {
  it("purges the post, its comments and unused files, keeps coin-anchored files, and forwards once", async () => {
    await seedPost(post("p1", alice.id, { manifestIds: ["m1", "m-coin"] }));
    await seedPost(post("p2", alice.id, { manifestIds: [] }));
    h.table("comments").set("c1", { id: "c1", postId: "p1", author: eve.id, text: "hi", createdAt: "" });
    h.table("manifests").set("m1", { fileId: "m1", chunks: ["k1"], createdAt: "" });
    h.table("manifests").set("m-coin", { fileId: "m-coin", chunks: ["k2"], createdAt: "", _coinId: "coin-1" });
    h.table("chunks").set("k1", { ref: "k1" });
    h.table("chunks").set("k2", { ref: "k2" });

    const sent: Array<{ n: number; exclude?: string }> = [];
    lc.registerTombstoneTransport((list, exclude) => {
      sent.push({ n: list.length, exclude });
      return 1;
    });
    const purged: string[][] = [];
    lc.onContentPurged((ids) => purged.push(ids));

    const t = await signPostTombstone(alice, "p1");
    expect(await lc.receiveTombstones([t], "peer-charlie")).toHaveLength(1);

    expect(h.table("posts").has("p1")).toBe(false);
    expect(h.table("posts").has("p2")).toBe(true);
    expect(h.table("comments").has("c1")).toBe(false);
    expect(h.table("manifests").has("m1")).toBe(false);
    expect(h.table("chunks").has("k1")).toBe(false);
    expect(h.table("manifests").has("m-coin")).toBe(true);
    expect(h.table("chunks").has("k2")).toBe(true);
    expect(purged).toEqual([["p1"]]);
    expect(sent).toEqual([{ n: 1, exclude: "peer-charlie" }]);

    // Same tombstone again (gossip echo) is neither re-applied nor re-forwarded.
    expect(await lc.receiveTombstones([t], "peer-dave")).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it("ignores forged tombstones and cannot be used to block another author's post id", async () => {
    await seedPost(post("p1", alice.id));
    const forged = await signPostTombstone(eve, "p1", alice.id);
    const evesOwn = await signPostTombstone(eve, "p1"); // valid, but only covers Eve's own post "p1"
    expect(await lc.receiveTombstones([forged], "peer-eve")).toHaveLength(0);
    expect(await lc.receiveTombstones([evesOwn], "peer-eve")).toHaveLength(1);
    expect(h.table("posts").has("p1")).toBe(true);
    expect(lc.isPostTombstoned("p1", alice.id)).toBe(false);

    // Alice's real tombstone still lands after Eve's.
    expect(await lc.receiveTombstones([await signPostTombstone(alice, "p1")])).toHaveLength(1);
    expect(h.table("posts").has("p1")).toBe(false);
  });

  it("refuses a resurrected post and hands back the tombstone for the sender", async () => {
    const t = await signPostTombstone(alice, "p1");
    await lc.receiveTombstones([t]);
    const old = post("p1", alice.id);
    expect(await lc.shouldAcceptIncomingPost(old)).toBe(false);
    expect(lc.tombstonesFor([{ id: "p1", author: alice.id }])).toEqual([t]);
  });

  it("an account tombstone purges every post and comment by the author and blocks new ones", async () => {
    await seedPost(post("a1", alice.id));
    await seedPost(post("a2", alice.id));
    await seedPost(post("e1", eve.id));
    h.table("comments").set("c1", { id: "c1", postId: "e1", author: alice.id, text: "x", createdAt: "" });

    const t = await lc.signTombstone(
      { type: "account_tombstone", authorId: alice.id, deletedAt: new Date().toISOString() },
      alice.privateKey,
      alice.publicKey,
    );
    expect(await lc.receiveTombstones([t])).toHaveLength(1);
    expect([...h.table("posts").keys()]).toEqual(["e1"]);
    expect(h.table("comments").has("c1")).toBe(false);
    expect(await lc.shouldAcceptIncomingPost(post("a3", alice.id))).toBe(false);
  });
});

describe("our own deletions", () => {
  it("signs, stores and broadcasts a post tombstone when the key is unlocked", async () => {
    const mine = post("m1", me.id, { _origin: "local" });
    await seedPost(mine);
    const outbound: lc.ContentTombstone[] = [];
    lc.registerTombstoneTransport((list) => {
      outbound.push(...list);
      return 2;
    });

    const result = await lc.tombstoneOwnPost(mine);
    expect(result).toEqual({ signed: true, peersReached: 2 });
    expect(h.table("posts").has("m1")).toBe(false);
    expect(outbound).toHaveLength(1);
    expect(await lc.verifyTombstone(outbound[0])).toBe(true);
    expect(lc.getActiveTombstones()).toEqual(outbound);
  });

  it("deletes locally while the key is locked and sends the tombstone once it unlocks", async () => {
    const mine = post("m1", me.id, { _origin: "local" });
    await seedPost(mine);
    h.auth.privateKey = null;
    const outbound: lc.ContentTombstone[] = [];
    lc.registerTombstoneTransport((list) => {
      outbound.push(...list);
      return 1;
    });

    expect(await lc.tombstoneOwnPost(mine)).toEqual({ signed: false, peersReached: 0 });
    expect(h.table("posts").has("m1")).toBe(false);
    expect(lc.isPostTombstoned("m1", me.id)).toBe(true);
    expect(lc.getActiveTombstones()).toHaveLength(0);

    h.auth.privateKey = me.privateKey;
    expect(await lc.flushPendingTombstones()).toBe(1);
    expect(outbound).toHaveLength(1);
    expect(lc.getActiveTombstones()).toHaveLength(1);
  });

  it("issues an account tombstone only with the identity key", async () => {
    h.auth.privateKey = null;
    expect(await lc.issueAccountTombstone()).toBeNull();
    const result = await lc.issueAccountTombstone(me.privateKey);
    expect(result?.signed).toBe(true);
    const [t] = lc.getActiveTombstones();
    expect(t.type).toBe("account_tombstone");
    expect(await lc.verifyTombstone(t)).toBe(true);
  });
});

describe("fadeout and favorites", () => {
  const now = Date.now();

  it("fades an inactive author's posts but keeps favorites and our own posts", async () => {
    await seedPost(post("a1", alice.id, { createdAt: new Date(now - 40 * DAY).toISOString() }));
    await seedPost(post("a2", alice.id, { createdAt: new Date(now - 40 * DAY).toISOString() }));
    await seedPost(post("m1", me.id, { createdAt: new Date(now - 90 * DAY).toISOString() }));
    await lc.setPostFavorited("a2", true);
    lc.noteAuthorSeen(alice.id, now - 16 * DAY);
    lc.noteAuthorSeen(me.id, now - 90 * DAY);

    const result = await lc.sweepContentLifecycle(now);
    expect(result.faded).toEqual(["a1"]);
    expect([...h.table("posts").keys()].sort()).toEqual(["a2", "m1"]);
  });

  it("keeps an old post alive while its author stays active (lastSeen, not createdAt)", async () => {
    await seedPost(post("a1", alice.id, { createdAt: new Date(now - 200 * DAY).toISOString() }));
    lc.noteAuthorSeen(alice.id, now - 2 * DAY);
    expect((await lc.sweepContentLifecycle(now)).faded).toEqual([]);
  });

  it("gives content held before this feature a fresh grace window", async () => {
    await seedPost(post("a1", alice.id, { createdAt: new Date(now - 200 * DAY).toISOString() }));
    expect((await lc.sweepContentLifecycle(now)).faded).toEqual([]);
    expect(lc.getAuthorLastSeen(alice.id)).toBe(Math.min(now, Date.now()));
  });

  it("does not let a relayed old post refresh its author's clock", async () => {
    lc.noteAuthorSeen(alice.id, now - 20 * DAY);
    lc.noteAuthorActivityFromPost(post("a1", alice.id, { createdAt: new Date(now - 30 * DAY).toISOString() }));
    expect(lc.getAuthorLastSeen(alice.id)).toBe(now - 20 * DAY);
    expect(await lc.shouldAcceptIncomingPost(post("a1", alice.id, { createdAt: new Date(now - 30 * DAY).toISOString() }))).toBe(false);
    // A newly written post is proof of activity.
    expect(await lc.shouldAcceptIncomingPost(post("a9", alice.id))).toBe(true);
  });

  it("accepts a faded author's post this device favorited", async () => {
    lc.noteAuthorSeen(alice.id, now - 20 * DAY);
    await lc.setPostFavorited("a1", true);
    expect(await lc.shouldAcceptIncomingPost(post("a1", alice.id, { createdAt: new Date(now - 30 * DAY).toISOString() }))).toBe(true);
  });

  it("a tombstone overrides a favorite", async () => {
    await seedPost(post("a1", alice.id));
    await lc.setPostFavorited("a1", true);
    await lc.receiveTombstones([await signPostTombstone(alice, "a1")]);
    expect(h.table("posts").has("a1")).toBe(false);
    expect(await lc.shouldAcceptIncomingPost(post("a1", alice.id))).toBe(false);
  });

  it("merges presence hints by max and clamps future times to now", async () => {
    lc.noteAuthorSeen(alice.id, now - 5 * DAY);
    lc.receivePresenceHints({ [alice.id]: now - 9 * DAY, [eve.id]: now + 365 * DAY });
    expect(lc.getAuthorLastSeen(alice.id)).toBe(now - 5 * DAY);
    expect(lc.getAuthorLastSeen(eve.id)).toBeLessThanOrEqual(Date.now());
    expect(Object.keys(lc.getPresenceHints())).toEqual(expect.arrayContaining([alice.id, eve.id]));
  });

  it("drops expired tombstones so the store stays small", async () => {
    await lc.receiveTombstones([await signPostTombstone(alice, "p1")]);
    const later = Date.now() + 31 * DAY;
    expect((await lc.sweepContentLifecycle(later)).expiredTombstones).toBe(1);
    expect(h.table("contentTombstones").size).toBe(0);
  });
});
