import { describe, it, expect, vi } from "vitest";
import {
  MERGE_CHANNEL,
  MERGE_CODE_TTL_MS,
  MergeController,
  generateMergeCode,
  mergeCodeProof,
  normalizeMergeCode,
  proofsEqual,
  type MergeExecutor,
  type MergePeerIdentity,
} from "../mergeProtocol";
import type { MergeAccountSummary } from "@/lib/blockchain/accountMerge";

const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };

function summary(id: string, name: string, extra: Partial<MergeAccountSummary> = {}): MergeAccountSummary {
  return { userId: id, username: name, discriminator: null, createdAt: "2026-11-12T00:00:00.000Z", swarm: 0, credits: 0, mintme: 0, posts: 0, contacts: 0, coldAddress: null, ...extra };
}

/** Two controllers joined by an in-memory link. */
function pair() {
  const handlers = new Map<string, (from: string, payload: unknown) => void>();
  const log: Array<{ from: string; to: string; kind: string }> = [];
  const transport = (self: string, other: string) => ({
    send: (channel: string, peerId: string, payload: unknown) => {
      expect(channel).toBe(MERGE_CHANNEL);
      log.push({ from: self, to: peerId, kind: (payload as { kind: string }).kind });
      const h = handlers.get(peerId);
      // Deliver asynchronously like a data channel, with a JSON round trip.
      setTimeout(() => h?.(self, JSON.parse(JSON.stringify(payload))), 0);
      return true;
    },
    onMessage: (_c: string, h: (from: string, payload: unknown) => void) => { handlers.set(self, h); return () => handlers.delete(self); },
    getConnectedPeerIds: () => [other],
  });
  const identity = (id: string, name: string): MergePeerIdentity => ({ userId: id, username: name, publicKey: `pk-${id}` });
  const calls: string[] = [];
  const executor = (id: string, name: string, extra: Partial<MergeAccountSummary> = {}): MergeExecutor => ({
    localIdentity: () => identity(id, name),
    verifyIdentity: async (i) => i.publicKey === `pk-${i.userId}`,
    buildSummary: async () => summary(id, name, extra),
    unlock: async (pw) => { if (pw !== `pw-${name}`) throw new Error("bad password"); return `key-${id}`; },
    sweep: async (master, onStep) => {
      calls.push(`sweep:${id}->${master.userId}`);
      onStep("moved");
      return { txs: [], creditTxId: "credit-1", swarm: 3.2, credits: 450, mintme: 0, mintmeOnChain: null };
    },
    collect: async () => ({ posts: [{ id: "p1", author: id, type: "text", content: "x".repeat(60_000), createdAt: "2026-11-18T00:00:00.000Z" }, { id: "p2", author: id, type: "text", content: "hi", createdAt: "2026-11-18T00:00:00.000Z" }], favorites: ["f1"], connections: [], library: [] }),
    attest: async (input) => {
      calls.push(`attest:${input.privateKey}`);
      return { type: "account_merged", version: 1, retiringId: input.retiringId, masterId: input.masterId, timestamp: "t", transfers: input.transfers, signerPublicKey: input.publicKey, signature: "sig" };
    },
    acceptOnMaster: async ({ bundle, privateKey }) => {
      calls.push(`accept:${privateKey}:${bundle.posts.length}:${bundle.attestation.transfers.txIds.join(",")}`);
      return { ack: { type: "account_merge_ack", version: 1, masterId: bundle.attestation.masterId, retiringId: bundle.attestation.retiringId, attestationSignature: "sig", timestamp: "t", signerPublicKey: "pk", signature: "ack" }, postsReattributed: bundle.posts.length, contactsAdded: 0 };
    },
    retire: async ({ privateKey, ack }) => { calls.push(`retire:${privateKey}:${ack.signature}`); return { tombstoned: true }; },
  });
  let t = 1_000_000;
  const now = () => t;
  const a = new MergeController({ now });
  const b = new MergeController({ now });
  a.attach(transport("peer-a", "peer-b"), executor("aaaaaaaaaaaaaaaa", "DeviceA", { swarm: 14.5 }));
  b.attach(transport("peer-b", "peer-a"), executor("bbbbbbbbbbbbbbbb", "DeviceB", { swarm: 3.2, credits: 450 }));
  return { a, b, log, calls, advance: (ms: number) => { t += ms; } };
}

describe("merge code", () => {
  it("is six random digits without modulo bias", () => {
    for (let i = 0; i < 50; i++) expect(generateMergeCode()).toMatch(/^\d{6}$/);
    // A value above the unbiased limit is rejected and redrawn.
    const values = [0xffffffff, 742915];
    expect(generateMergeCode((b) => { b[0] = values.shift()!; return b; })).toBe("742915");
    expect(normalizeMergeCode("742 915")).toBe("742915");
  });

  it("binds proofs to the code, role, identity and nonce", async () => {
    const parts = { sessionId: "s", role: "acceptor" as const, userId: "u", nonce: "n" };
    const p = await mergeCodeProof("123456", parts);
    expect(proofsEqual(p, await mergeCodeProof("123456", parts))).toBe(true);
    expect(proofsEqual(p, await mergeCodeProof("123457", parts))).toBe(false);
    expect(proofsEqual(p, await mergeCodeProof("123456", { ...parts, role: "initiator" }))).toBe(false);
    expect(proofsEqual(p, await mergeCodeProof("123456", { ...parts, nonce: "m" }))).toBe(false);
  });
});

describe("merge handshake", () => {
  it("holds an offer silently until the acceptor opens the panel, then pairs on the right code", async () => {
    const { a, b, log } = pair();
    const listener = vi.fn();
    a.initiate("peer-b");
    await flush();
    const code = a.snapshot().session!.code!;
    expect(a.snapshot().session!.phase).toBe("offering");
    // B only stores it; a panel that subscribes later still finds it.
    b.subscribe(listener);
    const offers = b.snapshot().offers;
    expect(offers).toHaveLength(1);
    expect(offers[0].from.username).toBe("DeviceA");
    // The code itself is never sent.
    expect(JSON.stringify(log)).not.toContain(code);

    b.accept(offers[0].sessionId);
    await b.submitCode(code);
    await flush();
    expect(a.snapshot().session!.phase).toBe("paired");
    expect(b.snapshot().session!.phase).toBe("paired");
    expect(a.snapshot().session!.code).toBeNull();
    expect(a.snapshot().session!.remoteSummary?.username).toBe("DeviceB");
    expect(b.snapshot().session!.remoteSummary?.swarm).toBe(14.5);
  });

  it("re-sends an open offer when the acceptor probes", async () => {
    const { a, b, log } = pair();
    a.initiate("peer-b");
    await flush();
    log.length = 0;
    b.probe();
    await flush();
    expect(log.map((l) => l.kind)).toEqual(["merge:probe", "merge:offer"]);
  });

  it("cancels after three wrong codes", async () => {
    const { a, b } = pair();
    a.initiate("peer-b");
    await flush();
    const code = a.snapshot().session!.code!;
    const wrong = code === "000000" ? "111111" : "000000";
    b.accept(b.snapshot().offers[0].sessionId);
    for (let i = 0; i < 3; i++) {
      await b.submitCode(wrong);
      await flush();
    }
    expect(a.snapshot().session!.phase).toBe("cancelled");
    expect(b.snapshot().session!.phase).toBe("cancelled");
    await b.submitCode(code);
    await flush();
    expect(a.snapshot().session!.phase).toBe("cancelled");
  });

  it("expires the code after three minutes", async () => {
    const { a, b, advance } = pair();
    a.initiate("peer-b");
    await flush();
    const code = a.snapshot().session!.code!;
    b.accept(b.snapshot().offers[0].sessionId);
    advance(MERGE_CODE_TTL_MS + 1);
    a.tick();
    b.tick();
    expect(a.snapshot().session!.phase).toBe("expired");
    expect(a.snapshot().session!.code).toBeNull();
    expect(b.snapshot().session!.phase).toBe("expired");
    expect(b.snapshot().offers).toHaveLength(0);
    await b.submitCode(code);
    await flush();
    expect(a.snapshot().session!.phase).toBe("expired");
  });

  it("mirrors the master choice, needs both passwords, then sweeps, attests, acks and retires in order", async () => {
    const { a, b, calls } = pair();
    a.initiate("peer-b");
    await flush();
    const code = a.snapshot().session!.code!;
    b.accept(b.snapshot().offers[0].sessionId);
    await b.submitCode(code);
    await flush();

    b.selectMaster("aaaaaaaaaaaaaaaa");
    await flush();
    expect(a.snapshot().session!.masterUserId).toBe("aaaaaaaaaaaaaaaa");
    expect(a.isLocalMaster()).toBe(true);

    await expect(a.authorize("wrong")).rejects.toThrow();
    await a.authorize("pw-DeviceA");
    await flush();
    expect(a.canExecute()).toBe(false); // B has not unlocked yet
    await b.authorize("pw-DeviceB");
    await flush();
    expect(a.canExecute()).toBe(true);
    expect(b.canExecute()).toBe(true);

    // Changing the master clears both authorizations.
    a.selectMaster("bbbbbbbbbbbbbbbb");
    await flush();
    expect(b.snapshot().session!.localAuthorized).toBe(false);
    a.selectMaster("aaaaaaaaaaaaaaaa");
    await flush();
    await a.authorize("pw-DeviceA");
    await b.authorize("pw-DeviceB");
    await flush();

    await a.execute();
    await flush();
    await flush();
    expect(calls).toEqual([
      "sweep:bbbbbbbbbbbbbbbb->aaaaaaaaaaaaaaaa",
      "attest:key-bbbbbbbbbbbbbbbb",
      "accept:key-aaaaaaaaaaaaaaaa:2:credit-1",
      "retire:key-bbbbbbbbbbbbbbbb:ack",
    ]);
    expect(a.snapshot().session!.phase).toBe("done");
    expect(a.snapshot().session!.absorbed?.postsReattributed).toBe(2);
    expect(b.snapshot().session!.phase).toBe("done");
    expect(b.snapshot().session!.retired?.masterUsername).toBe("DeviceA");
  });

  it("ignores session messages from a different peer", async () => {
    const { a, b } = pair();
    a.initiate("peer-b");
    await flush();
    const sessionId = b.snapshot().offers[0].sessionId;
    await a.handle("peer-evil", { kind: "merge:decline", sessionId });
    expect(a.snapshot().session!.phase).toBe("offering");
  });
});
