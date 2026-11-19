import { describe, it, expect, vi, beforeEach } from "vitest";

const db = new Map<string, unknown>();
vi.mock("@/lib/store", () => ({
  put: vi.fn(async (_s: string, row: { k: string; v: unknown }) => { db.set(row.k, structuredClone(row)); }),
  get: vi.fn(async (_s: string, k: string) => db.get(k)),
  remove: vi.fn(async (_s: string, k: string) => { db.delete(k); }),
  getAll: vi.fn(async () => []),
}));

import { genIdentityKeyPair, computeUserId } from "@/lib/crypto";
import { sealRecoveryVault } from "../recoveryVault";
import * as custody from "../vaultCustody";

async function identity() {
  const keys = await genIdentityKeyPair();
  const id = await computeUserId(keys.publicKey);
  return { privateKey: keys.privateKey, user: { id, username: "mike", publicKey: keys.publicKey, createdAt: "2026-01-01T00:00:00.000Z" } };
}

function fakeTransport(peers: string[] = ["peer-a"]) {
  const sent: Array<{ peerId: string; payload: custody.VaultMessage }> = [];
  let handler: ((p: string, m: unknown) => void) | null = null;
  return {
    sent,
    deliver: (from: string, msg: unknown) => handler?.(from, msg),
    transport: {
      send: (_c: string, peerId: string, payload: unknown) => { sent.push({ peerId, payload: payload as custody.VaultMessage }); return true; },
      onMessage: (_c: string, h: (p: string, m: unknown) => void) => { handler = h; return () => { handler = null; }; },
      getConnectedPeerIds: () => peers,
    },
  };
}

beforeEach(() => db.clear());

describe("vault custody", () => {
  it("holds a verified envelope, acks it, and only accepts higher versions", async () => {
    const me = await identity();
    const t = fakeTransport();
    const stop = custody.startVaultCustody({ transport: t.transport, getActiveUserId: () => null });
    const v2 = await sealRecoveryVault({ ...me, version: 2, passphrase: "p" });
    const v1 = await sealRecoveryVault({ ...me, version: 1, passphrase: "p" });

    await custody.handleVaultMessage("peer-owner", { kind: "store", envelope: v2 });
    expect(t.sent.at(-1)).toEqual({ peerId: "peer-owner", payload: { kind: "ack", userId: me.user.id, version: 2, signature: v2.signature } });
    expect((await custody.getHeldVault(me.user.id))?.version).toBe(2);

    const before = t.sent.length;
    await custody.handleVaultMessage("peer-owner", { kind: "store", envelope: v1 });
    // Stale version: no ack; the newer shell is handed back instead.
    expect(t.sent.slice(before).map((m) => m.payload.kind)).toEqual(["store"]);
    expect((t.sent.at(-1)!.payload as { envelope: { version: number } }).envelope.version).toBe(2);
    expect((await custody.getHeldVault(me.user.id))?.version).toBe(2);

    await custody.handleVaultMessage("peer-x", { kind: "store", envelope: { ...v2, version: 7 } });
    expect((await custody.getHeldVault(me.user.id))?.version).toBe(2); // forged version refused
    stop();
  });

  it("answers queries with the held envelope", async () => {
    const me = await identity();
    const t = fakeTransport();
    const stop = custody.startVaultCustody({ transport: t.transport, getActiveUserId: () => null });
    const v1 = await sealRecoveryVault({ ...me, version: 1, passphrase: "p" });
    await custody.holdVault(v1, "peer-owner");
    await custody.handleVaultMessage("peer-new-device", { kind: "query", userId: me.user.id, requestId: "r1" });
    const reply = t.sent.at(-1)!;
    expect(reply.payload.kind).toBe("response");
    expect((reply.payload as { envelope: { version: number } }).envelope.version).toBe(1);
    stop();
  });

  it("rotation pushes the new shell and owner acks fire once per peer", async () => {
    const me = await identity();
    const t = fakeTransport(["peer-a", "peer-b"]);
    const stop = custody.startVaultCustody({ transport: t.transport, getActiveUserId: () => me.user.id, getPeerName: () => "Ada" });
    await custody.sealGenesisVault(me.privateKey, me.user, "signup-pass");
    const rotated = await custody.rotateRecoveryShell(me.privateKey, me.user, "new shell phrase");
    expect(rotated.envelope.version).toBe(2);
    expect(rotated.genesisDefault).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.sent.filter((s) => s.payload.kind === "store").map((s) => s.peerId).sort()).toEqual(["peer-a", "peer-b"]);

    const events: custody.CustodyAckEvent[] = [];
    const off = custody.onCustodyAck((e) => events.push(e));
    await custody.handleVaultMessage("peer-a", { kind: "ack", userId: me.user.id, version: 2 });
    await custody.handleVaultMessage("peer-a", { kind: "ack", userId: me.user.id, version: 2 });
    await custody.handleVaultMessage("peer-b", { kind: "ack", userId: me.user.id, version: 1 }); // stale
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ peerId: "peer-a", peerName: "Ada", version: 2, firstForVersion: true });
    expect(Object.keys((await custody.getCustodyAcks(me.user.id)).peers)).toEqual(["peer-a"]);
    off();
    stop();
  });

  it("queryVaultFromPeer resolves with a verified response", async () => {
    const me = await identity();
    const t = fakeTransport();
    const stop = custody.startVaultCustody({ transport: t.transport, getActiveUserId: () => null });
    const v1 = await sealRecoveryVault({ ...me, version: 1, passphrase: "p" });
    const pending = custody.queryVaultFromPeer("peer-host", me.user.id, 2000);
    const q = t.sent.at(-1)!.payload as { requestId: string };
    t.deliver("peer-host", { kind: "response", requestId: q.requestId, envelope: v1 });
    expect((await pending)?.version).toBe(1);
    stop();
  });

  it("concurrent stores keep every held vault in the capped index", async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => identity()));
    const envs = await Promise.all(ids.map((me) => sealRecoveryVault({ ...me, version: 1, passphrase: "p" })));
    await Promise.all(envs.map((e) => custody.holdVault(e, "peer-flood")));
    const index = (db.get("recovery:custody-index") as { v: Record<string, number> }).v;
    expect(Object.keys(index).sort()).toEqual(ids.map((m) => m.user.id).sort());
  });

  it("rotation allocates above a newer shell another device already published", async () => {
    const me = await identity();
    const t = fakeTransport([]);
    const stop = custody.startVaultCustody({ transport: t.transport, getActiveUserId: () => me.user.id });
    await custody.sealGenesisVault(me.privateKey, me.user, "signup-pass");
    const fromOtherDevice = await sealRecoveryVault({ ...me, version: 2, passphrase: "other device phrase" });
    await custody.handleVaultMessage("peer-other", { kind: "store", envelope: fromOtherDevice });
    expect((await custody.getOwnVault(me.user.id))?.envelope.version).toBe(2);
    const rotated = await custody.rotateRecoveryShell(me.privateKey, me.user, "third phrase here");
    expect(rotated.envelope.version).toBe(3);
    stop();
  });
});

describe("vault custody follow-ups", () => {
  it("equal versions converge on one deterministic winner and the loser is handed back", async () => {
    const me = await identity();
    const t = fakeTransport([]);
    const stop = custody.startVaultCustody({ transport: t.transport, getActiveUserId: () => null });
    const a = await sealRecoveryVault({ ...me, version: 2, passphrase: "device a", now: new Date(Date.now() - 60_000) });
    const b = await sealRecoveryVault({ ...me, version: 2, passphrase: "device b", now: new Date() });

    await custody.handleVaultMessage("peer-b", { kind: "store", envelope: b });
    const sentBefore = t.sent.length;
    await custody.handleVaultMessage("peer-a", { kind: "store", envelope: a });
    expect((await custody.getHeldVault(me.user.id))?.signature).toBe(b.signature);
    const reply = t.sent.slice(sentBefore);
    expect(reply).toHaveLength(1);
    expect(reply[0]).toMatchObject({ peerId: "peer-a", payload: { kind: "store", envelope: { signature: b.signature } } });

    // Order of arrival does not matter.
    db.clear();
    await custody.holdVault(a, "peer-a");
    await custody.holdVault(b, "peer-b");
    expect((await custody.getHeldVault(me.user.id))?.signature).toBe(b.signature);
    stop();
  });

  it("an ack for a same-version tie-break loser is not counted as custody", async () => {
    const me = await identity();
    const t = fakeTransport([]);
    const stop = custody.startVaultCustody({ transport: t.transport, getActiveUserId: () => me.user.id });
    await custody.sealGenesisVault(me.privateKey, me.user, "pw-one");
    await custody.handleVaultMessage("peer-x", { kind: "ack", userId: me.user.id, version: 1, signature: "someone-else" });
    expect(Object.keys((await custody.getCustodyAcks(me.user.id)).peers)).toHaveLength(0);
    stop();
  });

  it("legacy accounts get a genesis vault once, and it follows a local password change", async () => {
    const me = await identity();
    const t = fakeTransport([]);
    const stop = custody.startVaultCustody({ transport: t.transport, getActiveUserId: () => me.user.id });
    const first = await custody.ensureGenesisVault(me.privateKey, me.user, "account-pass");
    expect(first?.envelope.version).toBe(1);
    expect(first?.genesisDefault).toBe(true);
    expect(await custody.ensureGenesisVault(me.privateKey, me.user, "other")).toBeNull();

    const followed = await custody.followPasswordChange(me.privateKey, me.user, "new-account-pass");
    expect(followed?.envelope.version).toBe(2);
    expect((await custody.getOwnVault(me.user.id))?.genesisDefault).toBe(true);
    const { openRecoveryVault } = await import("../recoveryVault");
    await expect(openRecoveryVault(followed!.envelope, "new-account-pass")).resolves.toBeTruthy();

    await custody.rotateRecoveryShell(me.privateKey, me.user, "separate recovery phrase");
    expect(await custody.followPasswordChange(me.privateKey, me.user, "yet-another")).toBeNull();
    stop();
  });

  it("a password-resealed shell stays an account shell when another device adopts it", async () => {
    const me = await identity();
    const t = fakeTransport([]);
    const stop = custody.startVaultCustody({ transport: t.transport, getActiveUserId: () => me.user.id });
    await custody.sealGenesisVault(me.privateKey, me.user, "pw-one");
    const followed = await custody.followPasswordChange(me.privateKey, me.user, "pw-two");
    expect(followed?.envelope.shell).toBe("account");

    // A fresh device restores v2: the signed mode survives adoption.
    db.clear();
    await custody.adoptRestoredVault(followed!.envelope);
    expect((await custody.getOwnVault(me.user.id))?.genesisDefault).toBe(true);
    expect((await custody.followPasswordChange(me.privateKey, me.user, "pw-three"))?.envelope.version).toBe(3);

    const separate = await custody.rotateRecoveryShell(me.privateKey, me.user, "separate recovery phrase");
    expect(separate.envelope.shell).toBe("recovery");
    db.clear();
    await custody.handleVaultMessage("peer-own", { kind: "store", envelope: separate.envelope });
    expect((await custody.getOwnVault(me.user.id))?.genesisDefault).toBe(false);
    stop();
  });

  it("the shell mode is signed: flipping it breaks verification", async () => {
    const me = await identity();
    const env = await sealRecoveryVault({ ...me, version: 2, passphrase: "phrase", shell: "recovery" });
    const { verifyRecoveryVault } = await import("../recoveryVault");
    expect(await verifyRecoveryVault(env)).toBe(true);
    expect(await verifyRecoveryVault({ ...env, shell: "account" })).toBe(false);
    const legacy = await sealRecoveryVault({ ...me, version: 1, passphrase: "phrase" });
    expect(legacy.shell).toBeUndefined();
    expect(await verifyRecoveryVault(legacy)).toBe(true);
  });

  it("an own-vault tie-break winner is handed back instead of acking the loser", async () => {
    const me = await identity();
    const t = fakeTransport([]);
    const stop = custody.startVaultCustody({ transport: t.transport, getActiveUserId: () => me.user.id });
    const ours = await custody.rotateRecoveryShell(me.privateKey, me.user, "phrase on this device");
    const winnerIsOurs = ours.envelope;
    // Build a same-version rival that loses the tie-break.
    const rival = await sealRecoveryVault({ ...me, version: winnerIsOurs.version, passphrase: "other device", now: new Date(Date.parse(winnerIsOurs.createdAt) - 60_000) });
    const { supersedes } = await import("../recoveryVault");
    expect(supersedes(winnerIsOurs, rival)).toBe(true);

    const sentBefore = t.sent.length;
    await custody.handleVaultMessage("peer-other", { kind: "store", envelope: rival });
    const reply = t.sent.slice(sentBefore);
    expect(reply).toHaveLength(1);
    expect(reply[0]).toMatchObject({ peerId: "peer-other", payload: { kind: "store", envelope: { signature: winnerIsOurs.signature } } });
    expect(await custody.getHeldVault(me.user.id)).toBeNull();
    stop();
  });
});

describe("vault retirement", () => {
  it("drops a held vault, refuses new holds and never serves a retired identity", async () => {
    const me = await identity();
    const t = fakeTransport();
    const stop = custody.startVaultCustody({ transport: t.transport, getActiveUserId: () => null });
    const v1 = await sealRecoveryVault({ ...me, version: 1, passphrase: "p" });
    await custody.handleVaultMessage("peer-owner", { kind: "store", envelope: v1 });
    expect((await custody.getHeldVault(me.user.id))?.version).toBe(1);

    const retired = new Set<string>([me.user.id]);
    custody.setVaultRetirementCheck((id) => retired.has(id));
    expect(await custody.retireHeldVault(me.user.id)).toBe(true);
    expect(await custody.getHeldVault(me.user.id)).toBeNull();

    const v2 = await sealRecoveryVault({ ...me, version: 2, passphrase: "p" });
    expect(await custody.holdVault(v2, "peer-owner")).toBe(false);
    expect(await custody.getHeldVault(me.user.id)).toBeNull();

    t.sent.length = 0;
    await custody.handleVaultMessage("peer-x", { kind: "query", userId: me.user.id, requestId: "r1" });
    expect(t.sent.at(-1)?.payload).toEqual({ kind: "response", requestId: "r1", envelope: null });

    custody.setVaultRetirementCheck(() => false);
    stop();
  });

  it("removes the retiring device's own vault and acks", async () => {
    const me = await identity();
    await custody.sealGenesisVault(me.privateKey, me.user, "signup-pass");
    expect(await custody.getOwnVault(me.user.id)).not.toBeNull();
    await custody.retireOwnVault(me.user.id);
    expect(await custody.getOwnVault(me.user.id)).toBeNull();
    expect((await custody.getCustodyAcks(me.user.id)).version).toBe(0);
  });
});
