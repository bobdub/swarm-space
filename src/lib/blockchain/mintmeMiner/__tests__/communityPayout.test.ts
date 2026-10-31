import { describe, expect, it } from "vitest";
import type { SwarmTransaction } from "../../types";
import { nativeMintMeBalanceUnits } from "../../wallets/nativeMintmeLedger";
import { INFINITY_VAULTS, infinityVaultEvmAddress } from "../../infinity/vaults";
import { swarmIdToEvmAddress } from "../../gateway/addressMap";
import { availableCommunityUnits, buildCommunityPayoutTx, canAppendCommunityPayout, communityProposalId, verifyCommunityPayoutTx, type MintMeCommunityVote } from "../communityPayout";
import { MintMeCommunityPayout, MINTME_COMMUNITY_CHANNEL } from "../communityPayoutService";
import { MINTME_UNIT } from "../payoutPolicy";

type Handler = (peer: string, message: unknown) => void;
const MIN = 60_000;

function bus() {
  const handlers = new Map<string, Handler>();
  return {
    transport(id: string) {
      return {
        broadcast: (_c: string, message: unknown) => {
          for (const [peer, handler] of handlers) if (peer !== id) queueMicrotask(() => handler(id, structuredClone(message)));
        },
        onMessage: (channel: string, handler: Handler) => {
          expect(channel).toBe(MINTME_COMMUNITY_CHANNEL);
          handlers.set(id, handler);
          return () => handlers.delete(id);
        },
      };
    },
  };
}

const clock = { t: 0 };
function node(id: string, network: ReturnType<typeof bus>, vault: () => bigint, peers: () => number) {
  const ledger: SwarmTransaction[] = [];
  const service = new MintMeCommunityPayout({
    transport: network.transport(id),
    connectedPeerCount: peers,
    readVaultUnits: async () => vault(),
    ledger: {
      transactions: () => ledger,
      accept: async tx => {
        if (!verifyCommunityPayoutTx(tx) || ledger.some(t => t.id === tx.id) || !canAppendCommunityPayout(ledger, tx)) return false;
        ledger.push(tx); return true;
      },
    },
    memberId: () => `user-${id}`,
    now: () => clock.t,
    sweepWaitMs: 200,
  });
  service.start();
  return { userId: `user-${id}`, ledger, service };
}

/** Start the heartbeat window, then pass 30 minutes. */
function warm(nodes: { service: MintMeCommunityPayout }[]) {
  clock.t = 0; nodes.forEach(n => n.service.heartbeat());
  clock.t = 30 * MIN; nodes.forEach(n => n.service.heartbeat());
}
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms));
const vote = (voterId: string, agree: boolean, units = 25n * MINTME_UNIT): MintMeCommunityVote =>
  ({ proposalId: communityProposalId(0, units), round: 0, availableUnits: units.toString(), voterId, agree });

describe("Infinity MintMe community payouts", () => {
  it("Infinity's MintMe vault has a fixed public address matching the native mapping", async () => {
    expect(infinityVaultEvmAddress(INFINITY_VAULTS.mintme)).toBe(await swarmIdToEvmAddress(INFINITY_VAULTS.mintme));
    expect(infinityVaultEvmAddress(INFINITY_VAULTS.mintme)).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("two members who both see 25 MINTME get 11.875 each and 1.25 goes to the market", async () => {
    const network = bus();
    const a = node("A", network, () => 25n * MINTME_UNIT, () => 1);
    const b = node("B", network, () => 25n * MINTME_UNIT, () => 1);
    warm([a, b]);
    await a.service.tick(); await settle();
    for (const n of [a, b]) {
      expect(n.ledger).toHaveLength(1);
      expect(n.ledger[0].signature).toBe("");
      expect(nativeMintMeBalanceUnits(n.ledger, a.userId)).toBe(11_875n * MINTME_UNIT / 1000n);
      expect(nativeMintMeBalanceUnits(n.ledger, b.userId)).toBe(11_875n * MINTME_UNIT / 1000n);
      expect(nativeMintMeBalanceUnits(n.ledger, INFINITY_VAULTS.market)).toBe(125n * MINTME_UNIT / 100n);
      expect(availableCommunityUnits(25n * MINTME_UNIT, n.ledger)).toBe(0n);
    }
  });

  it("waits for 30 minutes of shared heartbeat before acting", async () => {
    const network = bus();
    const a = node("A", network, () => 25n * MINTME_UNIT, () => 1);
    const b = node("B", network, () => 25n * MINTME_UNIT, () => 1);
    clock.t = 0; a.service.heartbeat(); b.service.heartbeat();
    clock.t = 29 * MIN;
    await a.service.tick(); await settle();
    expect(a.ledger).toHaveLength(0);
  });

  it("does nothing below 25 MINTME", async () => {
    const network = bus();
    const a = node("A", network, () => 24n * MINTME_UNIT, () => 1);
    const b = node("B", network, () => 24n * MINTME_UNIT, () => 1);
    warm([a, b]);
    await a.service.tick(); await settle();
    expect(a.ledger).toHaveLength(0); expect(b.ledger).toHaveLength(0);
  });

  it("never pays the same pool twice", async () => {
    const network = bus();
    const a = node("A", network, () => 25n * MINTME_UNIT, () => 1);
    const b = node("B", network, () => 25n * MINTME_UNIT, () => 1);
    warm([a, b]);
    await a.service.tick(); await settle();
    await a.service.tick(); await b.service.tick(); await settle();
    expect(a.ledger).toHaveLength(1); expect(b.ledger).toHaveLength(1);
    expect(canAppendCommunityPayout(a.ledger, a.ledger[0])).toBe(false);
  });

  it("a 2 vs 2 tie is settled by Infinity's mesh check when synced readings confirm the pool", async () => {
    const network = bus();
    const pool = 25n * MINTME_UNIT;
    // C lags slightly on the first answer but is synced by the time Infinity checks.
    let cView = 20n * MINTME_UNIT;
    const a = node("A", network, () => pool, () => 3);
    const b = node("B", network, () => pool, () => 3);
    const c = node("C", network, () => cView, () => 3);
    const d = node("D", network, () => 20n * MINTME_UNIT, () => 3);
    warm([a, b, c, d]);
    // Fill each node's view cache, then let C catch up only for the sweep.
    await Promise.all([a, b, c, d].map(n => n.service.tick())); await settle(100);
    expect(a.ledger).toHaveLength(0);
    cView = pool; clock.t += 31_000;
    await settle(600);
    expect(a.ledger.length + b.ledger.length).toBeGreaterThanOrEqual(1);
    const tx = (a.ledger[0] ?? b.ledger[0]);
    expect(tx.meta?.tieBreak).toBeTruthy();
    expect(tx.meta?.recipients).toEqual(["user-A", "user-B"]);
  });

  it("Infinity does not break a tie when the mesh check shows the pool is below 25", () => {
    const votes = [vote("a", true), vote("b", true), vote("c", false), vote("d", false)];
    const low = { readings: ["a", "b", "c", "d"].map((v, i) => ({ voterId: v, units: String((i < 1 ? 25n : 20n) * MINTME_UNIT) })), decision: true };
    expect(buildCommunityPayoutTx(votes, 3, low)).toBeNull();
    const high = { readings: ["a", "b", "c", "d"].map((v, i) => ({ voterId: v, units: String((i < 3 ? 25n : 20n) * MINTME_UNIT) })), decision: true };
    expect(buildCommunityPayoutTx(votes, 3, high)).not.toBeNull();
  });

  it("one member alone cannot pay, and a majority is required", () => {
    expect(buildCommunityPayoutTx([vote("a", true)])).toBeNull();
    expect(buildCommunityPayoutTx([vote("a", true), vote("b", true)], 2)).not.toBeNull();
    expect(buildCommunityPayoutTx([vote("a", true), vote("b", true), vote("c", false)], 3)).toBeNull();
  });

  it("rejects an edited payout record", () => {
    const tx = buildCommunityPayoutTx([vote("a", true), vote("b", true)])!;
    expect(verifyCommunityPayoutTx(tx)).toBe(true);
    const extra = structuredClone(tx);
    extra.meta!.recipients = [...(tx.meta!.recipients as string[]), "intruder"];
    expect(verifyCommunityPayoutTx(extra)).toBe(false);
    const bigger = structuredClone(tx);
    bigger.meta!.perPeerUnits = (BigInt(tx.meta!.perPeerUnits as string) * 2n).toString();
    expect(verifyCommunityPayoutTx(bigger)).toBe(false);
  });
});
