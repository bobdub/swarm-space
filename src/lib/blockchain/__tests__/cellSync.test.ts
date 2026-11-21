import { afterEach, describe, expect, it } from "vitest";
import { computeUserId, genIdentityKeyPair } from "@/lib/crypto";
import { signerFromKeys } from "../blockHeader";
import { endorsementSignerFromKeys } from "../endorsements";
import { memoryCellChainStorage } from "../cellChain/cellChain";
import { CellChains } from "../cellChain/cellChains";
import { CellSession, type CellSigners, type CellTransport } from "../cellChain/cellSync";
import { rosterSignerFromKeys } from "../cellChain/roster";

const CELL = "u/alice/ab12";
const T0 = Date.parse("2026-12-01T00:00:00Z");

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

async function newSigners(): Promise<CellSigners> {
  const keys = await genIdentityKeyPair();
  const userId = await computeUserId(keys.publicKey);
  return {
    text: rosterSignerFromKeys(userId, keys.publicKey, keys.privateKey),
    block: signerFromKeys(userId, keys.publicKey, keys.privateKey),
    endorse: endorsementSignerFromKeys(userId, keys.publicKey, keys.privateKey),
  };
}

/** A tiny in-memory mesh: every node is linked to every other. */
class Net {
  handlers = new Map<string, (from: string, payload: unknown) => void>();
  peerHandlers = new Map<string, (peers: string[]) => void>();
  sent: { from: string; to: string; payload: { t: string } }[] = [];
  transport(id: string): CellTransport {
    return {
      selfPeerId: () => id,
      peers: () => [...this.handlers.keys()].filter((p) => p !== id),
      send: (to, payload) => {
        this.sent.push({ from: id, to, payload: payload as { t: string } });
        const h = this.handlers.get(to);
        // Through JSON, as over a data channel.
        if (h) setTimeout(() => h(id, JSON.parse(JSON.stringify(payload))), 0);
      },
      onMessage: (h) => { this.handlers.set(id, h); return () => this.handlers.delete(id); },
      onPeersChange: (h) => { this.peerHandlers.set(id, h); return () => this.peerHandlers.delete(id); },
    };
  }
  linkAll(): void {
    for (const [id, h] of this.peerHandlers) h([...this.handlers.keys()].filter((p) => p !== id));
  }
}

const settle = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 2)); };

interface Node { signers: CellSigners; chains: CellChains; session: CellSession }
const sessions: CellSession[] = [];
afterEach(() => { for (const s of sessions.splice(0)) s.stop(); });

function node(net: Net, id: string, signers: CellSigners, clock: { t: number }, mining = false, expectedOwner?: string): Node {
  const chains = new CellChains(memoryStore(), { storage: memoryCellChainStorage(), difficulty: 1, now: () => clock.t });
  const session = new CellSession(CELL, chains, net.transport(id), {
    signers: async () => signers, miningEnabled: () => mining, now: () => clock.t, claimStore: memoryStore(), expectedOwner,
  });
  sessions.push(session);
  return { signers, chains, session };
}

describe("cell chain sync", () => {
  it("brings an invited account into the cell, then passes mined blocks and endorsements", async () => {
    const clock = { t: T0 + 30_000 };
    const net = new Net();
    const ownerSigners = await newSigners();
    const owner = node(net, "peer-owner", ownerSigners, clock, true);
    const bob = node(net, "peer-bob", await newSigners(), clock, false, ownerSigners.text.userId);
    await owner.chains.ensureOwned(CELL, "Garden Club", ownerSigners.text, T0);
    expect(await owner.chains.invite(CELL, bob.signers.text.userId, ownerSigners.text, T0 + 1)).not.toBeNull();

    owner.session.start();
    bob.session.start();
    net.linkAll();
    await settle();

    // Bob proved his account, got the genesis and his invite, and accepted it.
    expect(owner.session.accountOf("peer-bob")).toBe(bob.signers.text.userId);
    const bobChain = (await bob.chains.chain(CELL))!;
    const ownerChain = (await owner.chains.chain(CELL))!;
    expect(bobChain.chainId).toBe(ownerChain.chainId);
    expect(ownerChain.getPendingTransactions().length).toBe(2);

    // The owner mines: the block carries the invite and acceptance, and reaches Bob.
    clock.t += 30_000;
    const block = await owner.session.tick();
    expect(block).not.toBeNull();
    await settle();
    expect(bobChain.getLatestBlock().hash).toBe(block!.hash);
    expect(bobChain.getRoster().isMember(bob.signers.text.userId)).toBe(true);
    expect(bobChain.ticker).toBe("GARDEN");

    // Bob is a member now, so he endorses the next block, and the block after records it.
    clock.t += 30_000;
    const second = await owner.session.tick();
    await settle();
    expect(net.sent.some((m) => m.from === "peer-bob" && m.payload.t === "endorse")).toBe(true);
    clock.t += 30_000;
    const third = (await owner.session.tick())!;
    expect(third.witnesses?.map((e) => e.voter)).toEqual([bob.signers.text.userId]);
    expect(third.witnesses?.[0].blockHash).toBe(second!.hash);
    expect(third.witnesses?.[0].network).toBe(ownerChain.chainId);
  });

  it("sends nothing about the cell to an account that isn't a member or invitee", async () => {
    const clock = { t: T0 + 30_000 };
    const net = new Net();
    const ownerSigners = await newSigners();
    const owner = node(net, "peer-owner", ownerSigners, clock);
    const stranger = node(net, "peer-x", await newSigners(), clock);
    await owner.chains.ensureOwned(CELL, "Garden Club", ownerSigners.text, T0);
    owner.session.start();
    stranger.session.start();
    net.linkAll();
    await settle();
    expect(owner.session.accountOf("peer-x")).toBe(stranger.signers.text.userId);
    const leaked = net.sent.filter((m) => m.from === "peer-owner" && m.to === "peer-x" && !["hello", "proof"].includes(m.payload.t));
    expect(leaked).toEqual([]);
    expect(await stranger.chains.chain(CELL)).toBeNull();
  });

  it("ignores a peer whose proof doesn't match its key", async () => {
    const clock = { t: T0 + 30_000 };
    const net = new Net();
    const ownerSigners = await newSigners();
    const liar = await newSigners();
    const victim = await newSigners();
    const owner = node(net, "peer-owner", ownerSigners, clock);
    // The liar signs with its own key but claims the victim's account.
    const forged: CellSigners = { ...liar, text: { ...liar.text, userId: victim.text.userId } };
    const imposter = node(net, "peer-liar", forged, clock);
    await owner.chains.ensureOwned(CELL, "Garden Club", ownerSigners.text, T0);
    await owner.chains.invite(CELL, victim.text.userId, ownerSigners.text, T0 + 1);
    owner.session.start();
    imposter.session.start();
    net.linkAll();
    await settle();
    expect(owner.session.accountOf("peer-liar")).toBeUndefined();
    expect(await imposter.chains.chain(CELL)).toBeNull();
  });

  it("drops a live block stamped far from the mesh clock", async () => {
    const clock = { t: T0 + 30_000 };
    const net = new Net();
    const ownerSigners = await newSigners();
    const owner = node(net, "peer-owner", ownerSigners, clock, true);
    const bob = node(net, "peer-bob", await newSigners(), clock);
    await owner.chains.ensureOwned(CELL, "Garden Club", ownerSigners.text, T0);
    await owner.chains.invite(CELL, bob.signers.text.userId, ownerSigners.text, T0 + 1);
    owner.session.start();
    bob.session.start();
    net.linkAll();
    await settle();
    const bobClock = { t: clock.t };
    // Bob's clock is far behind: the live block looks 10 minutes early to him.
    (bob.session as unknown as { now: () => number }).now = () => bobClock.t - 10 * 60_000;
    clock.t += 30_000;
    await owner.session.tick();
    await settle();
    expect((await bob.chains.chain(CELL))!.getChain()).toHaveLength(1);
  });
});
