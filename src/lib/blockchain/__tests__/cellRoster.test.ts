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

async function newSigner(): Promise<TextSigner> {
  const keys = await genIdentityKeyPair();
  return rosterSignerFromKeys(await computeUserId(keys.publicKey), keys.publicKey, keys.privateKey);
}

const CELL = "u/alice/ab12";
/** Time of the block carrying the records under test. */
const BLOCK = 1_000_000;

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
    expect(await roster.apply(invite, BLOCK)).toBe(true);
    expect(roster.isMember(bob.userId)).toBe(false);
    const accept = await signRosterRecord(await acceptRecord(invite, 3_000), bob);
    expect(await roster.apply(accept, BLOCK)).toBe(true);
    expect(roster.isMember(bob.userId)).toBe(true);
    // The same invite can't be used twice.
    expect(await roster.apply(accept, BLOCK)).toBe(false);
  });

  it("rejects an invite from a non-owner, and an acceptance by someone else", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const mallory = await newSigner();
    const roster = (await CellRoster.fromGenesis(await genesisFor(owner)))!;
    const selfInvite = await signRosterRecord(inviteRecord(roster.chainId, mallory.userId, 2_000), mallory);
    expect(await roster.apply(selfInvite, BLOCK)).toBe(false);
    const invite = await signRosterRecord(inviteRecord(roster.chainId, bob.userId, 2_000), owner);
    await roster.apply(invite, BLOCK);
    const stolen = await signRosterRecord(await acceptRecord(invite, 3_000), mallory);
    expect(await roster.apply(stolen, BLOCK)).toBe(false);
    expect(roster.isMember(mallory.userId)).toBe(false);
  });

  it("rejects an acceptance after the invite expires", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const roster = (await CellRoster.fromGenesis(await genesisFor(owner)))!;
    const invite = await signRosterRecord(inviteRecord(roster.chainId, bob.userId, 2_000, 1_000), owner);
    await roster.apply(invite, BLOCK);
    const accept = await signRosterRecord(await acceptRecord(invite, 2_500), bob);
    // Judged by the block's time: a block after the expiry can't carry it.
    expect(await roster.apply(accept, 3_001)).toBe(false);
    expect(await roster.apply(accept, 3_000)).toBe(true);
  });

  it("rejects a record stamped after the block that carries it", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const roster = (await CellRoster.fromGenesis(await genesisFor(owner, 1_000)))!;
    const invite = await signRosterRecord(inviteRecord(roster.chainId, bob.userId, Number.MAX_SAFE_INTEGER - 10), owner);
    expect(await roster.apply(invite, BLOCK)).toBe(false);
  });

  it("never applies the same record twice, so an old leave can't be replayed after a rejoin", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const roster = (await CellRoster.fromGenesis(await genesisFor(owner, 1_000)))!;
    const join = async (at: number) => {
      const invite = await signRosterRecord(inviteRecord(roster.chainId, bob.userId, at), owner);
      expect(await roster.apply(invite, BLOCK)).toBe(true);
      expect(await roster.apply(await signRosterRecord(await acceptRecord(invite, at + 1), bob), BLOCK)).toBe(true);
    };
    await join(2_000);
    const leave = await signRosterRecord(leaveRecord(roster.chainId, 3_000), bob);
    expect(await roster.apply(leave, BLOCK)).toBe(true);
    await join(4_000);
    expect(await roster.apply(leave, BLOCK)).toBe(false);
    expect(roster.isMember(bob.userId)).toBe(true);
  });

  it("rejects records for another cell chain, and records from before the cell existed", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const roster = (await CellRoster.fromGenesis(await genesisFor(owner, 5_000)))!;
    const otherChain = await signRosterRecord(inviteRecord("not-this-chain", bob.userId, 6_000), owner);
    expect(await roster.apply(otherChain, BLOCK)).toBe(false);
    const early = await signRosterRecord(inviteRecord(roster.chainId, bob.userId, 4_000), owner);
    expect(await roster.apply(early, BLOCK)).toBe(false);
  });

  it("lets a member leave and the owner remove a member, but the owner can't leave", async () => {
    const owner = await newSigner();
    const bob = await newSigner();
    const carol = await newSigner();
    const roster = (await CellRoster.fromGenesis(await genesisFor(owner)))!;
    let at = 2_000;
    for (const who of [bob, carol]) {
      const invite = await signRosterRecord(inviteRecord(roster.chainId, who.userId, at++), owner);
      await roster.apply(invite, BLOCK);
      await roster.apply(await signRosterRecord(await acceptRecord(invite, at++), who), BLOCK);
    }
    expect(roster.members.size).toBe(3);
    expect(await roster.apply(await signRosterRecord(leaveRecord(roster.chainId, at++), owner), BLOCK)).toBe(false);
    expect(await roster.apply(await signRosterRecord(removeRecord(roster.chainId, carol.userId, at++), bob), BLOCK)).toBe(false);
    expect(await roster.apply(await signRosterRecord(leaveRecord(roster.chainId, at++), bob), BLOCK)).toBe(true);
    expect(await roster.apply(await signRosterRecord(removeRecord(roster.chainId, carol.userId, at++), owner), BLOCK)).toBe(true);
    expect(roster.sortedMembers()).toEqual([owner.userId]);
  });

});

