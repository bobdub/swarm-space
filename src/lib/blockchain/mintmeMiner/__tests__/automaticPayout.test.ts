import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { computeUserId, genIdentityKeyPair } from "@/lib/crypto";
import { AutomaticMintMePayout } from "../automaticPayout";
import { IndexedDBMintMeVoteJournal } from "../payoutJournal";
import { VerifiedMintMeSharedSource } from "../sharedPayoutSource";
import { createMintMeProposal, verifyMintMeCertificate, type MintMeAgreementSnapshot, type MintMeAgreementCertificate } from "../payoutAgreement";
import { verifyMintMeFunding, type MintMeFundingReader } from "../verifiedFunding";

const database = vi.hoisted(() => ({ db: undefined as IDBDatabase | undefined }));
vi.mock("@/lib/store", () => ({ openDB: async () => { if (!database.db) throw new Error("Storage unavailable"); return database.db; } }));

beforeEach(async () => {
  database.db?.close();
  database.db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = new IDBFactory().open("payout-tests", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("blockchain", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
});

async function fixture() {
  const keys = await Promise.all([genIdentityKeyPair(), genIdentityKeyPair()]);
  const members = await Promise.all(keys.map(k => computeUserId(k.publicKey)));
  const snapshot: MintMeAgreementSnapshot = { checkpoint: "a".repeat(64), vaultAddress: `0x${"b".repeat(40)}`,
    members, receipts: [{ txHash: `0x${"c".repeat(64)}`, amountUnits: "25000000000000000000" }], expiresAt: Date.now() + 60_000 };
  return { keys, members, snapshot };
}

function reader(overrides: Partial<MintMeFundingReader> = {}): MintMeFundingReader {
  return {
    getNetwork: async () => ({ chainId: 24734n }), getBlockNumber: async () => 100,
    getBalance: async () => 25000000000000000000n, getBlock: async () => ({ hash: "canonical" }),
    getTransaction: async () => ({ to: `0x${"b".repeat(40)}`, from: `0x${"d".repeat(40)}`, value: 25000000000000000000n, blockHash: "canonical" }),
    getTransactionReceipt: async () => ({ status: 1, blockNumber: 89, blockHash: "canonical" }), ...overrides,
  };
}

describe("verified automatic community payouts", () => {
  it("verifies 25 confirmed MINTME against canonical receipts and configured vault", async () => {
    const { snapshot: s } = await fixture();
    expect(await verifyMintMeFunding(reader(), s.receipts, s.vaultAddress, s.vaultAddress)).toBe(true);
    expect(await verifyMintMeFunding(reader(), s.receipts, s.vaultAddress, `0x${"d".repeat(40)}`)).toBe(false);
  });
  it.each([
    ["wrong chain", { getNetwork: async () => ({ chainId: 1n }) }],
    ["unconfirmed", { getTransactionReceipt: async () => ({ status: 1, blockNumber: 90, blockHash: "canonical" }) }],
    ["failed", { getTransactionReceipt: async () => ({ status: 0, blockNumber: 89, blockHash: "canonical" }) }],
    ["reorg", { getBlock: async () => ({ hash: "replacement" }) }],
    ["spent vault", { getBalance: async () => 0n }],
    ["wrong amount", { getTransaction: async () => ({ to: `0x${"b".repeat(40)}`, from: `0x${"d".repeat(40)}`, value: 1n, blockHash: "canonical" }) }],
  ] as const)("rejects %s funding", async (_name, overrides) => {
    const { snapshot: s } = await fixture();
    expect(await verifyMintMeFunding(reader(overrides), s.receipts, s.vaultAddress, s.vaultAddress)).toBe(false);
  });
  it("rejects duplicate funding before RPC calls", async () => {
    const { snapshot: s } = await fixture();
    const network = vi.fn(reader().getNetwork);
    expect(await verifyMintMeFunding(reader({ getNetwork: network }), [...s.receipts, ...s.receipts], s.vaultAddress, s.vaultAddress)).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });
  it("requires the complete shared eligible snapshot, including receipt amounts and expiry", async () => {
    const { snapshot } = await fixture();
    const source = new VerifiedMintMeSharedSource({ readAuthenticatedSnapshot: async () => snapshot, commitExclusiveAllocation: async () => false }, snapshot.vaultAddress, async () => true);
    expect(await source.verifyCheckpoint(snapshot)).toBe(true);
    expect(await source.verifyCheckpoint({ ...snapshot, members: snapshot.members.slice(0, 1) })).toBe(false);
    expect(await source.verifyCheckpoint({ ...snapshot, expiresAt: snapshot.expiresAt + 1 })).toBe(false);
    expect(await source.verifyCheckpoint({ ...snapshot, receipts: [{ ...snapshot.receipts[0], amountUnits: "50000000000000000000" }] })).toBe(false);
  });
  it("reserves receipt/checkpoint atomically across instances and survives restart without double voting", async () => {
    const { snapshot, members } = await fixture();
    const first = await createMintMeProposal(snapshot);
    const other = await createMintMeProposal({ ...snapshot, checkpoint: "d".repeat(64), expiresAt: snapshot.expiresAt + 1 });
    const results = await Promise.all([new IndexedDBMintMeVoteJournal().reserve(first, members[0]), new IndexedDBMintMeVoteJournal().reserve(other, members[0])]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results[0] ? first : other, loser = results[0] ? other : first;
    expect(await new IndexedDBMintMeVoteJournal().reserve(winner, members[0])).toBe(true);
    expect(await new IndexedDBMintMeVoteJournal().reserve(loser, members[0])).toBe(false);
    const sameCheckpoint = await createMintMeProposal({ ...snapshot, checkpoint: winner.checkpoint, receipts: [{ ...snapshot.receipts[0], txHash: `0x${"e".repeat(64)}` }] });
    expect(await new IndexedDBMintMeVoteJournal().reserve(sameCheckpoint, members[0])).toBe(false);
  });
  it("fails closed when durable storage cannot commit", async () => {
    const { snapshot, members } = await fixture();
    database.db?.close(); database.db = undefined;
    await expect(new IndexedDBMintMeVoteJournal().reserve(await createMintMeProposal(snapshot), members[0])).rejects.toThrow("unavailable");
  });
  it("automatically gathers two approvals, retries failed delivery and commits only once via a shared allocation authority", async () => {
    const { snapshot, members, keys } = await fixture();
    const handlers = new Map<string, (peer: string, value: unknown) => void>();
    const queue: Array<() => void> = [];
    const balances = new Map<string, bigint>(), allocated = new Set<string>();
    let unavailable = true;
    let retained = 0n;
    const funding = vi.fn(async () => true);
    // Simulates the REQUIRED authoritative backend; not a live network implementation.
    const backend = {
      readAuthenticatedSnapshot: async () => snapshot,
      commitExclusiveAllocation: vi.fn(async (c: MintMeAgreementCertificate) => {
        if (unavailable) return false;
        if (allocated.has(c.proposal.receipts[0].txHash)) return true;
        if (!await verifyMintMeCertificate(c, source)) return false;
        allocated.add(c.proposal.receipts[0].txHash);
        retained += BigInt(c.proposal.communityUnits);
        for (const id of c.proposal.members) balances.set(id, (balances.get(id) ?? 0n) + BigInt(c.proposal.perPeerUnits));
        return true;
      }),
    };
    const source = new VerifiedMintMeSharedSource(backend, snapshot.vaultAddress, funding);
    const transports = members.map((id, index) => ({
      broadcast: (_channel: string, value: unknown) => queue.push(() => handlers.get(members[1 - index])?.(id, structuredClone(value))),
      onMessage: (_channel: string, handler: (peer: string, value: unknown) => void) => { handlers.set(id, handler); return () => { handlers.delete(id); }; },
    }));
    const nodes = members.map((userId, index) => new AutomaticMintMePayout(source, new IndexedDBMintMeVoteJournal(), {
      userId, publicKey: keys[index].publicKey, readUnlockedKey: async () => keys[index].privateKey,
    }));
    nodes.forEach((node, i) => node.start(transports[i]));
    await nodes[0].tick();
    for (let i = 0; i < 30; i++) { while (queue.length) queue.shift()?.(); await new Promise(r => setTimeout(r, 5)); }
    await nodes[0].tick();
    expect(backend.commitExclusiveAllocation).toHaveBeenCalled();
    expect(balances.size).toBe(0);
    unavailable = false;
    await nodes[0].tick(); await nodes[1].tick();
    expect(balances.get(members[0])).toBe(11875000000000000000n);
    expect(balances.get(members[1])).toBe(11875000000000000000n);
    expect(retained).toBe(1250000000000000000n);
    await nodes[0].tick(); await nodes[1].tick();
    expect(retained).toBe(1250000000000000000n);
    nodes.forEach(n => n.stop());
  });
  it("does not vote with a locked wallet or unavailable shared snapshot", async () => {
    const { snapshot, keys, members } = await fixture();
    const reserve = vi.fn(async () => true), commit = vi.fn(async () => true);
    const source = { readSnapshot: async () => snapshot, verifyCheckpoint: async () => true, verifyFunding: async () => true, commit };
    const node = new AutomaticMintMePayout(source, { reserve }, { userId: members[0], publicKey: keys[0].publicKey, readUnlockedKey: async () => null });
    node.start({ broadcast: vi.fn(), onMessage: () => () => {} });
    await node.tick(); await new Promise(r => setTimeout(r, 10));
    expect(reserve).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled(); node.stop();
  });
});