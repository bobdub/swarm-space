import { describe, expect, it } from "vitest";
import { computeUserId, genIdentityKeyPair } from "@/lib/crypto";
import type { SwarmTransaction } from "../../types";
import { nativeMintMeBalanceUnits } from "../../wallets/nativeMintmeLedger";
import { availableCommunityUnits, buildCommunityPayoutTx, canAppendCommunityPayout, signCommunityVote, verifyCommunityPayoutTx } from "../communityPayout";
import { MintMeCommunityPayout, MINTME_COMMUNITY_CHANNEL } from "../communityPayoutService";
import { MINTME_UNIT } from "../payoutPolicy";

type Handler = (peer: string, message: unknown) => void;

function bus() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    transport(id: string) {
      return {
        broadcast: (_channel: string, message: unknown) => {
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

async function node(id: string, network: ReturnType<typeof bus>, vault: () => bigint, peers: () => number) {
  const keys = await genIdentityKeyPair();
  const userId = await computeUserId(keys.publicKey);
  const ledger: SwarmTransaction[] = [];
  const service = new MintMeCommunityPayout({
    transport: network.transport(id),
    connectedPeerCount: peers,
    readVaultUnits: async () => vault(),
    ledger: {
      transactions: () => ledger,
      accept: async tx => {
        if (!await verifyCommunityPayoutTx(tx) || ledger.some(t => t.id === tx.id) || !canAppendCommunityPayout(ledger, tx)) return false;
        ledger.push(tx); return true;
      },
    },
    signer: async () => ({ publicKey: keys.publicKey, privateKey: keys.privateKey }),
  });
  service.start();
  return { keys, userId, ledger, service };
}

const settle = () => new Promise(r => setTimeout(r, 300));

describe("mesh-agreed MintMe community payouts", () => {
  it("two nodes that both see 25 MINTME pay 11.875 to each SWARM wallet and keep 1.25 in the pool", async () => {
    const network = bus();
    const a = await node("A", network, () => 25n * MINTME_UNIT, () => 1);
    const b = await node("B", network, () => 25n * MINTME_UNIT, () => 1);
    await a.service.tick();
    await settle();
    for (const n of [a, b]) {
      expect(n.ledger).toHaveLength(1);
      expect(nativeMintMeBalanceUnits(n.ledger, a.userId)).toBe(11_875n * MINTME_UNIT / 1000n);
      expect(nativeMintMeBalanceUnits(n.ledger, b.userId)).toBe(11_875n * MINTME_UNIT / 1000n);
      expect(n.ledger[0].meta?.communityUnits).toBe((125n * MINTME_UNIT / 100n).toString());
      expect(availableCommunityUnits(25n * MINTME_UNIT, n.ledger)).toBe(0n);
    }
  });

  it("does nothing below 25 MINTME", async () => {
    const network = bus();
    const a = await node("A", network, () => 24n * MINTME_UNIT, () => 1);
    const b = await node("B", network, () => 24n * MINTME_UNIT, () => 1);
    await a.service.tick(); await settle();
    expect(a.ledger).toHaveLength(0); expect(b.ledger).toHaveLength(0);
  });

  it("a node whose own view of the pool is lower does not agree, so nothing is paid", async () => {
    const network = bus();
    const a = await node("A", network, () => 30n * MINTME_UNIT, () => 1);
    const b = await node("B", network, () => 20n * MINTME_UNIT, () => 1);
    await a.service.tick(); await settle();
    expect(a.ledger).toHaveLength(0); expect(b.ledger).toHaveLength(0);
  });

  it("never pays the same pool twice", async () => {
    const network = bus();
    const a = await node("A", network, () => 25n * MINTME_UNIT, () => 1);
    const b = await node("B", network, () => 25n * MINTME_UNIT, () => 1);
    await a.service.tick(); await settle();
    await a.service.tick(); await b.service.tick(); await settle();
    expect(a.ledger).toHaveLength(1); expect(b.ledger).toHaveLength(1);
    // Replaying the recorded payout is refused.
    expect(canAppendCommunityPayout(a.ledger, a.ledger[0])).toBe(false);
  });

  it("one node alone cannot pay itself and a majority of a three-node mesh is required", async () => {
    const keys = await Promise.all([genIdentityKeyPair(), genIdentityKeyPair()]);
    const solo = await signCommunityVote(0, 25n * MINTME_UNIT, keys[0].publicKey, keys[0].privateKey);
    expect(await buildCommunityPayoutTx([solo])).toBeNull();
    const second = await signCommunityVote(0, 25n * MINTME_UNIT, keys[1].publicKey, keys[1].privateKey);
    expect(await buildCommunityPayoutTx([solo, second], 2)).not.toBeNull();
    expect(await buildCommunityPayoutTx([solo, second], 3)).toBeNull();
  });

  it("rejects an edited payout record", async () => {
    const keys = await Promise.all([genIdentityKeyPair(), genIdentityKeyPair()]);
    const votes = await Promise.all(keys.map(k => signCommunityVote(0, 25n * MINTME_UNIT, k.publicKey, k.privateKey)));
    const tx = (await buildCommunityPayoutTx(votes))!;
    expect(await verifyCommunityPayoutTx(tx)).toBe(true);
    const extraRecipient = structuredClone(tx);
    extraRecipient.meta!.recipients = [...(tx.meta!.recipients as string[]), "ffffffffffffffff"];
    expect(await verifyCommunityPayoutTx(extraRecipient)).toBe(false);
    const biggerShare = structuredClone(tx);
    biggerShare.meta!.perPeerUnits = (BigInt(tx.meta!.perPeerUnits as string) * 2n).toString();
    expect(await verifyCommunityPayoutTx(biggerShare)).toBe(false);
  });
});
