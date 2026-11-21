import { describe, expect, it } from "vitest";
import { genIdentityKeyPair, computeUserId } from "@/lib/crypto";
import { endorsementSignerFromKeys, signEndorsement, type Endorsement } from "../endorsements";
import {
  latestCheckpoint, NEWCOMER_WAIT_BLOCKS, ACTIVE_WINDOW_BLOCKS, Participation, selectWitnesses, verifyWitnesses, witnessRoot,
} from "../witnesses";
import type { SwarmBlock } from "../types";

const after = "2026-12-01T00:00:00.000Z";

function block(index: number, producer?: string, witnesses?: Partial<Endorsement>[]): SwarmBlock {
  return {
    index, timestamp: after, transactions: [], previousHash: `h${index - 1}`, hash: `h${index}`, nonce: 0, difficulty: 4,
    merkleRoot: "", miner: producer, ...(producer ? { version: 2, producer: { userId: producer, publicKey: "" } } : {}),
    ...(witnesses ? { witnesses: witnesses as Endorsement[] } : {}),
  };
}

const agree = (voter: string, parent: SwarmBlock) => ({ voter, blockHash: parent.hash, height: parent.index, agree: true });

async function voter() {
  const keys = await genIdentityKeyPair();
  return endorsementSignerFromKeys(await computeUserId(keys.publicKey), keys.publicKey, keys.privateKey);
}

describe("voters come from the chain", () => {
  it("makes a newcomer wait, and drops an account that went quiet", () => {
    const chain = [block(0)];
    for (let i = 1; i <= NEWCOMER_WAIT_BLOCKS + 1; i++) chain.push(block(i, i === 1 ? "old" : i === NEWCOMER_WAIT_BLOCKS ? "new" : "miner"));
    const p = Participation.of(chain);
    expect(p.voters().has("old")).toBe(true);
    expect(p.voters().has("new")).toBe(false);
    for (let i = chain.length; i < ACTIVE_WINDOW_BLOCKS + 2; i++) p.add(block(i, "miner"));
    expect(p.voters().has("old")).toBe(false);
    expect(p.voters().has("miner")).toBe(true);
  });

  it("records the parent's agreements, known accounts first, one new identity per block", () => {
    const parent = block(5, "p");
    const p = Participation.of([block(0), block(1, "known"), block(2, "me")]);
    const picked = selectWitnesses([
      agree("fresh-1", parent), agree("known", parent), agree("fresh-2", parent), agree("known", parent),
      agree("p", parent), { ...agree("other", parent), agree: false }, { ...agree("stale", parent), blockHash: "h4" },
    ] as Endorsement[], parent, "me", p);
    expect(picked.map((e) => e.voter)).toEqual(["known", "fresh-1"]);
    // A new producer uses up the block's one new identity itself.
    expect(selectWitnesses([agree("fresh-1", parent)] as Endorsement[], parent, "newbie", p)).toEqual([]);
  });

  it("checks recorded witnesses: signatures, root, parent and the new-identity limit", async () => {
    const [a, b] = await Promise.all([voter(), voter()]);
    const parent = block(1, "p");
    const known = { known: (id: string) => id === "me" || id === a.userId };
    const ea = await signEndorsement(parent, true, a, 1);
    const eb = await signEndorsement(parent, true, b, 1);
    const child = async (list: Endorsement[]) => ({ ...block(2, "me"), witnesses: list, witnessRoot: await witnessRoot(list) });
    expect(await verifyWitnesses(await child([ea, eb]), parent, known)).toBe(true);
    expect(await verifyWitnesses(await child([ea, eb]), parent, { known: () => false })).toBe(false);
    expect(await verifyWitnesses({ ...(await child([ea])), witnessRoot: "x" }, parent, known)).toBe(false);
    expect(await verifyWitnesses(await child([{ ...ea, observedAt: 2 }]), parent, known)).toBe(false);
    expect(await verifyWitnesses(await child([ea, ea]), parent, known)).toBe(false);
    expect(await verifyWitnesses(await child([ea]), block(1, a.userId), known)).toBe(false);
  });

  it("marks a checkpoint once a majority of voters signed the next block", () => {
    const chain = [block(0)];
    for (const id of ["a", "b", "c"]) chain.push(block(chain.length, id));
    while (chain.length < NEWCOMER_WAIT_BLOCKS + 4) chain.push(block(chain.length, "a"));
    const tip = chain[chain.length - 1];
    // Voters for a block by "a": b and c (its producer is left out). One of two isn't a majority.
    expect(latestCheckpoint([...chain, block(chain.length, "b", [agree("b", tip)])])).toBe(-1);
    expect(latestCheckpoint([...chain, block(chain.length, "b", [agree("b", tip), agree("c", tip)])])).toBe(tip.index);
  });
});
