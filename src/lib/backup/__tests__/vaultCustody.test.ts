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
    expect(t.sent.at(-1)).toEqual({ peerId: "peer-owner", payload: { kind: "ack", userId: me.user.id, version: 2 } });
    expect((await custody.getHeldVault(me.user.id))?.version).toBe(2);

    const before = t.sent.length;
    await custody.handleVaultMessage("peer-owner", { kind: "store", envelope: v1 });
    expect(t.sent.length).toBe(before); // stale version: no ack
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
