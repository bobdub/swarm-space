import { describe, expect, it } from "vitest";
import type { CreditTransaction } from "@/types";
import type { SwarmTransaction } from "@/lib/blockchain/types";
import { buildUnifiedHistory, CREDITS_ASSET, filterHistory, historyAssets, ledgerRows } from "./unifiedHistory";

const me = "member";
const credit = (over: Partial<CreditTransaction>): CreditTransaction => ({
  id: "c1", fromUserId: "system", toUserId: me, amount: 10, type: "earned_post",
  createdAt: "2026-11-17T10:00:00Z", ...over,
});
const chainTx = (over: Partial<SwarmTransaction>): SwarmTransaction => ({
  id: "t1", type: "wallet_tip", from: me, to: "friend", amount: 2, timestamp: "2026-11-17T11:00:00Z",
  signature: "", publicKey: "", nonce: 1, fee: 0, chainId: "SWARM", ...over,
});

describe("unified transaction history", () => {
  it("merges Credits and SWARM records into one newest-first list while keeping each asset", () => {
    const history = buildUnifiedHistory({
      userId: me,
      credits: [credit({})],
      chain: [chainTx({ meta: { ticker: "SWARM", intent: "tip" } })],
    });
    expect(history.map(e => [e.label, e.legs[0].asset, e.legs[0].direction, e.legs[0].settlement])).toEqual([
      ["Tip sent", "SWARM", "out", "swarm-ledger"],
      ["Post reward", CREDITS_ASSET, "in", "off-chain"],
    ]);
  });

  it("uses the same kinds for tips, transfers, deposits and rewards across assets", () => {
    const history = buildUnifiedHistory({
      userId: me,
      credits: [
        credit({ id: "tip", type: "tip", fromUserId: "friend", toUserId: me }),
        credit({ id: "xfer", type: "transfer", fromUserId: me, toUserId: "friend" }),
      ],
      chain: [
        chainTx({ id: "swarm-tip", from: "friend", to: me, meta: { intent: "tip", ticker: "SWARM" } }),
        chainTx({ id: "swarm-xfer", meta: { intent: "transfer", ticker: "SWARM" } }),
        chainTx({ id: "dep", type: "external_deposit", from: "bridge:mintme", to: me, meta: { currency: "MINTME" } }),
        chainTx({ id: "mine", type: "mining_reward", from: "system", to: me }),
      ],
    });
    const kinds = Object.fromEntries(history.map(e => [e.id, e.kind]));
    expect(kinds).toEqual({
      "credits:tip": "tip", "credits:xfer": "transfer",
      "chain:swarm-tip": "tip", "chain:swarm-xfer": "transfer",
      "chain:dep": "deposit", "chain:mine": "reward",
    });
    const deposit = history.find(e => e.id === "chain:dep")!;
    expect(deposit.legs[0]).toMatchObject({ asset: "MINTME", direction: "in", settlement: "mintme" });
    expect(deposit.counterparty).toBeUndefined();
  });

  it("hides credit_sync mirrors so a Credits reward never looks like SWARM", () => {
    const history = buildUnifiedHistory({
      userId: me,
      credits: [credit({})],
      chain: [chainTx({ id: "mirror", type: "credit_sync", from: "system", to: me, amount: 10 })],
    });
    expect(history).toHaveLength(1);
    expect(history[0].legs[0].asset).toBe(CREDITS_ASSET);
  });

  it("shows a wrap as one conversion with a Credits leg and a SWARM leg", () => {
    const description = "Locked 100 credits → 1 SWARM";
    const history = buildUnifiedHistory({
      userId: me,
      credits: [
        credit({ id: "deduct", type: "transfer", fromUserId: me, toUserId: "system", amount: 100, meta: { description } }),
        credit({ id: "wrap", type: "transfer", fromUserId: me, toUserId: "community-pool", amount: 100,
          createdAt: "2026-11-17T10:00:01Z", meta: { description, wrapRequestId: "w1" } }),
      ],
      chain: [chainTx({ id: "release", type: "credit_lock", from: "community-pool", to: me, amount: 1,
        timestamp: "2026-11-17T10:00:00Z", meta: { creditsLocked: 100 } })],
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "conversion", label: "Wrapped Credits to SWARM" });
    expect(history[0].legs).toEqual([
      expect.objectContaining({ asset: CREDITS_ASSET, amount: 100, direction: "out" }),
      expect.objectContaining({ asset: "SWARM", amount: 1, direction: "in" }),
    ]);
  });

  it("keeps an unrelated system debit with the same amount", () => {
    const history = buildUnifiedHistory({
      userId: me,
      credits: [credit({ id: "deploy", type: "transfer", fromUserId: me, toUserId: "system", amount: 25,
        meta: { description: "Creator Token Deployment" } })],
      chain: [],
    });
    expect(history[0]).toMatchObject({ kind: "spend", label: "Creator Token Deployment" });
  });

  it("counts a chain transaction once across pending and mined lists, and ignores other members", () => {
    const tx = chainTx({});
    const history = buildUnifiedHistory({
      userId: me, credits: [credit({ id: "other", toUserId: "someone" })],
      chain: [tx, tx, chainTx({ id: "x", from: "a", to: "b" })],
    });
    expect(history.map(e => e.id)).toEqual(["chain:t1"]);
  });

  it("labels sub-chain records with their chain ticker", () => {
    const history = buildUnifiedHistory({
      userId: me, credits: [],
      chain: [chainTx({ id: "sub", type: "token_transfer", chainId: "coin-abc", to: me, from: "friend" })],
      chains: [{ chainId: "coin-abc", ticker: "ABC" }],
    });
    expect(history[0].legs[0]).toMatchObject({ asset: "ABC", ticker: "ABC", direction: "in" });
  });

  it("filters by asset and kind, and lists Credits and SWARM first", () => {
    const history = buildUnifiedHistory({
      userId: me,
      credits: [credit({}), credit({ id: "tip", type: "tip", fromUserId: "friend" })],
      chain: [chainTx({ meta: { ticker: "SWARM" } }), chainTx({ id: "m", meta: { ticker: "MINTME" } })],
    });
    expect(historyAssets(history).map(a => a.asset)).toEqual([CREDITS_ASSET, "SWARM", "MINTME"]);
    expect(filterHistory(history, { asset: CREDITS_ASSET })).toHaveLength(2);
    expect(filterHistory(history, { kind: "tip" })).toHaveLength(3);
    expect(filterHistory(history, { asset: "SWARM", kind: "tip" })).toHaveLength(1);
  });

  it("shows creator-market trades as SWARM paid and creator tokens received", () => {
    const history = buildUnifiedHistory({
      userId: me, credits: [],
      chain: [
        chainTx({ id: "buy", type: "creator_token_buy", from: me, to: "creator", amount: 2,
          meta: { tokenId: "art", ticker: "ART", tokens: 100 } }),
        chainTx({ id: "sell", type: "creator_token_sell", from: "creator", to: me, amount: 1,
          timestamp: "2026-11-17T12:00:00Z", meta: { tokenId: "art", ticker: "ART", tokens: 50 } }),
      ],
    });
    const byId = Object.fromEntries(history.map(e => [e.id, e]));
    expect(byId["chain:buy"].legs).toEqual([
      expect.objectContaining({ asset: "SWARM", amount: 2, direction: "out" }),
      expect.objectContaining({ asset: "CREATOR:ART", ticker: "ART", amount: 100, direction: "in" }),
    ]);
    expect(byId["chain:sell"].legs.map(l => [l.asset, l.amount, l.direction])).toEqual([
      ["SWARM", 1, "in"], ["CREATOR:ART", 50, "out"],
    ]);
    expect(filterHistory(history, { asset: "SWARM" })).toHaveLength(2);
  });

  it("derives external settlement from currency and custody, not the record type alone", () => {
    const history = buildUnifiedHistory({
      userId: me, credits: [],
      chain: [
        chainTx({ id: "mm", type: "external_withdraw", from: me, to: "0xabc", meta: { kind: "swarm_withdraw", currency: "SWARM" } }),
        chainTx({ id: "eth", type: "external_deposit", from: "0xabc", to: me, meta: { currency: "ETH" } }),
        chainTx({ id: "native", type: "external_deposit", from: "0xdef", to: me,
          meta: { currency: "MINTME", custody: "mintme-native-custody-v1" } }),
        chainTx({ id: "token", type: "external_withdraw", from: me, to: "0x1", meta: { currency: "MINTME:0xT", symbol: "TOK", contract: "0xT" } }),
      ],
    });
    const settle = Object.fromEntries(history.map(e => [e.id, [e.legs[0].settlement, e.legs[0].ticker]]));
    expect(settle).toEqual({
      "chain:mm": ["swarm-ledger", "SWARM"],
      "chain:eth": ["external", "ETH"],
      "chain:native": ["mintme", "MINTME"],
      "chain:token": ["mintme", "TOK"],
    });
  });

  it("types weight: SWARM by engraving tier, Credits Minted, imports Ported, creator tokens CREATOR", () => {
    const history = buildUnifiedHistory({
      userId: me,
      credits: [credit({})],
      chain: [
        chainTx({ id: "rare", type: "coin_transfer", amount: 5, timestamp: "2026-11-17T13:00:00Z", meta: { coinId: "coin-r" } }),
        chainTx({ id: "hollow", meta: { ticker: "SWARM", assetId: "chain:SWARM", intent: "tip" }, timestamp: "2026-11-17T12:00:00Z" }),
        chainTx({ id: "mm", meta: { ticker: "MINTME", assetId: "external:MINTME" }, timestamp: "2026-11-17T11:30:00Z" }),
        chainTx({ id: "sub", type: "token_transfer", chainId: "coin-abc", timestamp: "2026-11-17T11:00:00Z" }),
        chainTx({ id: "buy", type: "creator_token_buy", from: me, to: "creator", amount: 2,
          timestamp: "2026-11-17T10:30:00Z", meta: { tokenId: "art", ticker: "ART", tokens: 100 } }),
      ],
      chains: [{ chainId: "coin-abc", ticker: "ABC" }],
      coinTiers: new Map([["coin-r", "rare"]]),
    });
    expect(ledgerRows(history).map(r => [r.ticker, r.action, r.direction, r.weight, r.amount])).toEqual([
      ["SWARM", "Transfer", "Outgoing", "Rare", 5],
      ["SWARM", "Tip", "Outgoing", "Hollow", 2],
      ["MINTME", "Tip", "Outgoing", "Ported", 2],
      ["ABC", "Transfer", "Outgoing", "CREATOR", 2],
      ["SWARM", "Trade", "Outgoing", "Hollow", 2],
      ["ART", "Trade", "Incoming", "CREATOR", 100],
      ["Credits", "Reward", "Incoming", "Minted", 10],
    ]);
  });

  it("puts both legs of a wrap in the ledger and filters rows by asset", () => {
    const history = buildUnifiedHistory({
      userId: me,
      credits: [credit({ id: "wrap", type: "transfer", fromUserId: me, toUserId: "community-pool", amount: 100,
        meta: { description: "Locked", wrapRequestId: "w1" } })],
      chain: [chainTx({ id: "release", type: "credit_lock", from: "community-pool", to: me, amount: 1,
        timestamp: "2026-11-17T10:00:00Z", meta: { creditsLocked: 100 } })],
    });
    expect(ledgerRows(history).map(r => [r.ticker, r.action, r.direction, r.weight, r.amount])).toEqual([
      ["Credits", "Conversion", "Outgoing", "Minted", 100],
      ["SWARM", "Conversion", "Incoming", "Hollow", 1],
    ]);
    expect(ledgerRows(history, "SWARM")).toHaveLength(1);
  });
});
