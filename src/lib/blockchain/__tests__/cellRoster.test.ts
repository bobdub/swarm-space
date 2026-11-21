import { describe, expect, it } from "vitest";
import { computeUserId, genIdentityKeyPair } from "@/lib/crypto";
import {
  acceptRecord,
  canonical,
  CellRoster,
  genesisRecord,
  inviteRecord,
  leaveRecord,
  removeRecord,
  rosterRecordHash,
  rosterSignerFromKeys,
  signRosterRecord,
  tickerFromName,
  verifyRosterRecord,
  type TextSigner,
} from "../cellChain/roster";
import { CellRosterStore } from "../cellChain/rosterStore";

async function newSigner(): Promise<TextSigner> {
  const keys = await genIdentityKeyPair();
  return rosterSignerFromKeys(await computeUserId(keys.publicKey), keys.publicKey, keys.privateKey);
}

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

const CELL = "u/alice/ab12";

async function genesisFor(owner: TextSigner, at = 1_000) {
  return signRosterRecord(genesisRecord(CELL, "Garden", owner.userId, at), owner);
}

describe("cell roster records", () => {
  it("serializes keys in a fixed order", () => {
    expect(canonical({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });

  it("takes the ticker from the cell name", () => {
    expect(tickerFromName("Garden Club")).toBe("GARDEN");
    expect(tickerFromName("b2b ops")).toBe("B2BOPS");
    expect(tickerFromName("Café")).toBe("CAFE");
    expect(tickerFromName("🌱 ✨")).toBe("CELL");
  });

  it("puts the ticker in the genesis and rejects a bad one", async () => {
    const owner = await newSigner();
    const g = await genesisFor(owner);
    expect((await CellRoster.fromGenesis(g))?.ticker).toBe("GARDEN");
    const bad = await signRosterRecord({ ...g.record, ticker: "garden!" } as typeof g.record, owner);
    expect(await CellRoster.fromGenesis(bad)).toBeNull();
  });

  it("verifies a signed record and rejects tampering", async () => {
    const owner = await newSigner();
    const g = await genesisFor(owner);
    expect(await verifyRosterRecord(g)).toBe(true);
    expect(await verifyRosterRecord({ ...g, record: { ...g.record, name: "Other" } })).toBe(false);
    const other = await newSigner();
    expect(await verifyRosterRecord({ ...g, signer: other.userId })).toBe(false);
    expect(await verifyRosterRecord({ ...g, publicKey: other.publicKey })).toBe(false);
  });

  it("starts with the owner as the only member, and the genesis hash as the chain id", async () => {
    const owner = await newSigner();
    const g = await genesisFor(owner);
    const roster = await CellRoster.fromGenesis(g);
    expect(roster?.sortedMembers()).toEqual([owner.userId]);
    expect(roster?.chainId).toBe(await rosterRecordHash(g));
  });

  it("refuses a genesis signed by someone other than the named owner", async () => {
    const owner = await newSigner();
    const forger = await newSigner();
    const forged = await signRosterRecord(genesisRecord(CELL, "Garden", owner.userId, 1_000), forger);
    expect(await CellRoster.fromGenesis(forged)).toBeNull();
  });
});

describe("joining, leaving and removal", () => {
  it("adds a member only with the owner's invite and the invitee's acceptance", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const g = await genesisFor(owner);
    const roster = (await CellRoster.fromGenesis(g))!;
    const invite = await signRosterRecord(inviteRecord(roster.chainId, bob.userId, 2_000), owner);
    expect(await roster.apply(invite)).toBe(true);
    expect(roster.isMember(bob.userId)).toBe(false);
    const accept = await signRosterRecord(await acceptRecord(invite, 3_000), bob);
    expect(await roster.apply(accept)).toBe(true);
    expect(roster.isMember(bob.userId)).toBe(true);
    // The same invite can't be used twice.
    expect(await roster.apply(accept)).toBe(false);
  });

  it("rejects an invite from a non-owner, and an acceptance by someone else", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const mallory = await newSigner();
    const roster = (await CellRoster.fromGenesis(await genesisFor(owner)))!;
    const selfInvite = await signRosterRecord(inviteRecord(roster.chainId, mallory.userId, 2_000), mallory);
    expect(await roster.apply(selfInvite)).toBe(false);
    const invite = await signRosterRecord(inviteRecord(roster.chainId, bob.userId, 2_000), owner);
    await roster.apply(invite);
    const stolen = await signRosterRecord(await acceptRecord(invite, 3_000), mallory);
    expect(await roster.apply(stolen)).toBe(false);
    expect(roster.isMember(mallory.userId)).toBe(false);
  });

  it("rejects an acceptance after the invite expires", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const roster = (await CellRoster.fromGenesis(await genesisFor(owner)))!;
    const invite = await signRosterRecord(inviteRecord(roster.chainId, bob.userId, 2_000, 1_000), owner);
    await roster.apply(invite);
    const late = await signRosterRecord(await acceptRecord(invite, 3_001), bob);
    expect(await roster.apply(late)).toBe(false);
  });

  it("rejects records for another cell chain, and records that go back in time", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const roster = (await CellRoster.fromGenesis(await genesisFor(owner, 5_000)))!;
    const otherChain = await signRosterRecord(inviteRecord("not-this-chain", bob.userId, 6_000), owner);
    expect(await roster.apply(otherChain)).toBe(false);
    const early = await signRosterRecord(inviteRecord(roster.chainId, bob.userId, 4_000), owner);
    expect(await roster.apply(early)).toBe(false);
  });

  it("lets a member leave and the owner remove a member, but the owner can't leave", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const carol = await newSigner();
    const roster = (await CellRoster.fromGenesis(await genesisFor(owner)))!;
    let at = 2_000;
    for (const who of [bob, carol]) {
      const invite = await signRosterRecord(inviteRecord(roster.chainId, who.userId, at++), owner);
      await roster.apply(invite);
      await roster.apply(await signRosterRecord(await acceptRecord(invite, at++), who));
    }
    expect(roster.members.size).toBe(3);
    expect(await roster.apply(await signRosterRecord(leaveRecord(roster.chainId, at++), owner))).toBe(false);
    expect(await roster.apply(await signRosterRecord(removeRecord(roster.chainId, carol.userId, at++), bob))).toBe(false);
    expect(await roster.apply(await signRosterRecord(leaveRecord(roster.chainId, at++), bob))).toBe(true);
    expect(await roster.apply(await signRosterRecord(removeRecord(roster.chainId, carol.userId, at++), owner))).toBe(true);
    expect(roster.sortedMembers()).toEqual([owner.userId]);
  });

});

describe("the roster store", () => {
  it("writes a genesis once, for the owner only, and folds appended records", async () => {
    const store = new CellRosterStore(memoryStore());
    const owner = await newSigner();
    const bob = await newSigner();
    const roster = await store.ensureGenesis(CELL, "Garden", owner, 1_000);
    expect(roster?.owner).toBe(owner.userId);
    expect(await store.ensureGenesis(CELL, "Garden", owner, 2_000)).not.toBeNull();
    expect(store.records(CELL)).toHaveLength(1);
    expect(await store.ensureGenesis(CELL, "Garden", bob, 2_000)).toBeNull();

    const invite = await store.invite(CELL, bob.userId, owner, 3_000);
    expect(invite).not.toBeNull();
    expect(await store.invite(CELL, owner.userId, bob, 3_500)).toBeNull();
    expect(await store.accept(CELL, invite!, bob, 4_000)).not.toBeNull();
    expect((await store.roster(CELL))?.isMember(bob.userId)).toBe(true);
  });

  it("never saves a record that doesn't fit, and ignores an edited store", async () => {
    const backing = memoryStore();
    const store = new CellRosterStore(backing);
    const owner = await newSigner();
    const mallory = await newSigner();
    await store.ensureGenesis(CELL, "Garden", owner, 1_000);
    const forgedInvite = await signRosterRecord(inviteRecord((await store.roster(CELL))!.chainId, mallory.userId, 2_000), mallory);
    expect(await store.append(CELL, forgedInvite)).toBe(false);
    expect(store.records(CELL)).toHaveLength(1);

    const list = store.records(CELL);
    list[0] = { ...list[0], record: { ...list[0].record, name: "Renamed" } } as typeof list[0];
    backing.setItem(`cell-roster-v1:${CELL}`, JSON.stringify(list));
    expect(await store.roster(CELL)).toBeNull();
  });

  it("adopts a longer valid list that extends ours, and nothing else", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const ownerStore = new CellRosterStore(memoryStore());
    await ownerStore.ensureGenesis(CELL, "Garden", owner, 1_000);
    const bobStore = new CellRosterStore(memoryStore());
    expect(await bobStore.adopt(CELL, ownerStore.records(CELL))).toBe(true);
    const invite = await ownerStore.invite(CELL, bob.userId, owner, 2_000);
    expect(await bobStore.adopt(CELL, ownerStore.records(CELL))).toBe(true);
    await bobStore.accept(CELL, invite!, bob, 3_000);
    expect((await bobStore.roster(CELL))?.isMember(bob.userId)).toBe(true);
    // A shorter list, or a different cell's genesis, is never adopted.
    expect(await bobStore.adopt(CELL, ownerStore.records(CELL))).toBe(false);
    const rivalStore = new CellRosterStore(memoryStore());
    await rivalStore.ensureGenesis(CELL, "Garden", await newSigner(), 1_000);
    const rival = rivalStore.records(CELL);
    expect(await bobStore.adopt(CELL, [...rival, ...rival, ...rival, ...rival])).toBe(false);
  });
});
