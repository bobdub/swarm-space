import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { getChainState, saveChainState } from "../storage";
import { openDB } from "../../store";
import type { ChainState, SwarmBlock } from "../types";

function block(index: number, tag = "a"): SwarmBlock {
  return {
    index,
    timestamp: new Date(1_700_000_000_000 + index * 15_000).toISOString(),
    transactions: [],
    previousHash: index === 0 ? "0" : `${tag}${index - 1}`,
    hash: `${tag}${index}`,
    nonce: 0,
    difficulty: 0,
    merkleRoot: "",
  };
}

function state(chain: SwarmBlock[]): ChainState {
  return {
    chain,
    pendingTransactions: [],
    difficulty: 0,
    miningReward: 10,
    totalSupply: 0,
    circulatingSupply: 0,
    lastBlockTime: chain[chain.length - 1].timestamp,
  };
}

async function rawState(): Promise<Record<string, unknown>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction("blockchain", "readonly").objectStore("blockchain").get("chain-state");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

describe("per-block chain storage", () => {
  it("keeps blocks in their own records, not inside chain-state", async () => {
    const chain = [0, 1, 2].map((i) => block(i));
    await saveChainState(state(chain));
    const raw = await rawState();
    expect(raw.chain).toBeUndefined();
    expect(raw.chainLength).toBe(3);
    const loaded = await getChainState();
    expect(loaded?.chain.map((b) => b.hash)).toEqual(["a0", "a1", "a2"]);
    expect(loaded?.storedLength).toBe(3);
  });

  it("writes only the changed tail and trims a longer old chain", async () => {
    const chain = [0, 1, 2, 3, 4].map((i) => block(i));
    await saveChainState(state(chain));
    // Adopt a shorter fork that diverges at #2.
    const fork = [block(0), block(1), block(2, "b"), block(3, "b")];
    fork[2].previousHash = "a1";
    await saveChainState(state(fork), fork.slice(2), 5);
    const loaded = await getChainState();
    expect(loaded?.chain.map((b) => b.hash)).toEqual(["a0", "a1", "b2", "b3"]);
  });

  it("still reads the old shape with the chain inline", async () => {
    const db = await openDB();
    const chain = [0, 1].map((i) => block(i, "L"));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("blockchain", "readwrite");
      tx.objectStore("blockchain").put({ ...state(chain), id: "chain-state" });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const loaded = await getChainState();
    expect(loaded?.chain.map((b) => b.hash)).toEqual(["L0", "L1"]);
    expect(loaded?.storedLength).toBeUndefined();
  });
});

describe("SwarmChain persistence", () => {
  it("moves an old inline chain to per-block records on load, and the hide snapshot no longer carries the chain", async () => {
    const { SwarmChain } = await import("../chain");
    const db = await openDB();
    const chain = [0, 1, 2].map((i) => block(i, "M"));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("blockchain", "readwrite");
      tx.objectStore("blockchain").put({ ...state(chain), id: "chain-state" });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    localStorage.clear();
    const c = new SwarmChain();
    await c.whenReady();
    const raw = await rawState();
    expect(raw.chain).toBeUndefined();
    expect(raw.chainLength).toBe(3);

    (c as unknown as { _syncFlush(): void })._syncFlush();
    const snap = JSON.parse(localStorage.getItem("__swarm_chain_snapshot") ?? "{}");
    expect(snap.v).toBe(2);
    expect(snap.tail).toEqual([]);

    const again = new SwarmChain();
    await again.whenReady();
    expect(again.getChain().map((b) => b.hash)).toEqual(["M0", "M1", "M2"]);
  });
});
