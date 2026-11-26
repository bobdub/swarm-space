import { describe, expect, it } from "vitest";
import type { SwarmTransaction } from "../types";
import { buildDonorLeaderboard, formatDonationAmounts, formatSwarmValue } from "./donorLeaderboard";
import { INFINITY_GIFT_VAULT } from "./vaults";
import { NATIVE_MINTME_ASSET_ID } from "../wallets/nativeMintmeLedger";

const tx = (p: Partial<SwarmTransaction>): SwarmTransaction => ({
  id: crypto.randomUUID(), type: "wallet_tip", from: "a", to: INFINITY_GIFT_VAULT, amount: 1,
  timestamp: "2026-01-01T00:00:00Z", signature: "", publicKey: "", nonce: 0, fee: 0, ...p,
});

const MINTME_META = { assetId: NATIVE_MINTME_ASSET_ID, currency: "MINTME", amountUnits: "3000000000000000000", ticker: "MINTME" };

describe("buildDonorLeaderboard", () => {
  it("counts gifts to Infinity and member vault donations, ranked by SWARM", () => {
    const board = buildDonorLeaderboard([
      tx({ from: "alice", amount: 10, meta: { assetId: "chain:SWARM", ticker: "SWARM" } }),
      tx({ from: "bob", amount: 50, type: "pool_donate", to: "community-pool" }),
      tx({ from: "alice", amount: 3, meta: MINTME_META }),
      tx({ from: "alice", amount: 5, meta: { assetId: "chain:SWARM", ticker: "SWARM" } }),
    ]);
    expect(board.donors.map((d) => d.userId)).toEqual(["bob", "alice"]);
    expect(board.donors[1].amounts).toEqual({ SWARM: 15, MINTME: 3 });
    expect(board.totals).toEqual({ SWARM: 65, MINTME: 3 });
    expect(board.donationCount).toBe(4);
  });

  it("skips system tax, tips to other people, and duplicate tx ids", () => {
    const dup = tx({ from: "carol", amount: 7, meta: { assetId: "chain:SWARM" } });
    const board = buildDonorLeaderboard([
      tx({ from: "system", type: "pool_donate", amount: 100 }),
      tx({ from: "dave", to: "0123456789abcdef", amount: 9 }),
      dup, dup,
    ]);
    expect(board.donors).toHaveLength(1);
    expect(board.totals).toEqual({ SWARM: 7 });
  });

  it("takes the currency from the settled asset, not the display ticker", () => {
    const board = buildDonorLeaderboard([
      tx({ from: "eve", amount: 3, meta: { ...MINTME_META, ticker: "SWARM" } }),
      tx({ from: "eve", amount: 9, meta: { assetId: "token:eve-coin", ticker: "SWARM" } }),
      tx({ from: "eve", amount: 4, meta: { assetId: "token:fox", ticker: "FOX" } }),
      tx({ from: "eve", amount: 1, meta: { ticker: "SWARM" } }),
    ]);
    expect(board.totals).toEqual({ MINTME: 3, "eve-coin": 9, FOX: 4 });
  });

  it("keys imported-token gifts by chain and contract, not by symbol", () => {
    const c = "0x634340447220bcaaa09a5505d71ca62b644a1a82";
    const tokenTip = (ref: string, currency: string) => ({ assetId: `custom:${ref}`, currency, ticker: "MTCG", decimals: 18, amountUnits: "2000000000000000000" });
    const board = buildDonorLeaderboard([
      tx({ from: "eve", amount: 2, meta: tokenTip(`eth:${c}`, `ETHEREUM:${c}`) }),
      tx({ from: "eve", amount: 2, meta: tokenTip(c, `MINTME:${c}`) }),
      tx({ from: "eve", amount: 2, meta: tokenTip(`eth:${c}`, `ETHEREUM:${c}`) }),
    ]);
    expect(board.totals).toEqual({ "MTCG (Ethereum 0x6343…1a82)": 4, "MTCG (0x6343…1a82)": 2 });
  });

  it("counts Ethereum vault donations apart from the same contract on MintMe", () => {
    const c = "0x634340447220bcaaa09a5505d71ca62b644a1a82";
    const gift = (currency: string, amount: number) => tx({ type: "custom_token_transfer", to: "community-pool", from: "eve", amount,
      meta: { currency, marketVault: true, direction: "donation", ticker: "MTCG" } });
    const board = buildDonorLeaderboard([gift(`ETHEREUM:${c}`, 3), gift(`MINTME:${c}`, 1), gift(`ETHEREUM:${c}`, 2)]);
    expect(board.totals).toEqual({ "MTCG (Ethereum 0x6343…1a82)": 5, "MTCG (0x6343…1a82)": 1 });
  });

  it("formats SWARM first", () => {
    expect(formatDonationAmounts({ MINTME: 2, SWARM: 1500 })).toBe(`${(1500).toLocaleString()} SWARM · 2 MINTME`);
  });
});

describe("hand-recorded donations", () => {
  it("adds ETH, BTC and gift-card donors and merges ones with a Swarm account", () => {
    const board = buildDonorLeaderboard(
      [tx({ from: "alice", amount: 10, meta: { assetId: "chain:SWARM", ticker: "SWARM" } })],
      [
        { donor: "Ada", amount: 0.05, currency: "eth", method: "ETH transfer", date: "2026-11-20" },
        { donor: "Satoshi fan", amount: 0.0012, currency: "BTC", date: "2026-11-21" },
        { donor: "Alice", userId: "alice", amount: 25, currency: "USD", method: "gift card", date: "2026-11-22" },
        { donor: "ada", amount: 0.01, currency: "ETH", date: "2026-11-23" },
      ],
    );
    expect(board.donors.map((d) => d.userId)).toEqual(["alice", "manual:ada", "manual:satoshi fan"]);
    expect(board.donors[0]).toMatchObject({ name: "Alice", amounts: { SWARM: 10, USD: 25 }, donations: 2 });
    expect(board.donors[1]).toMatchObject({ name: "Ada", amounts: { ETH: 0.06 }, donations: 2, lastAt: "2026-11-23T00:00:00.000Z" });
    expect(board.totals).toEqual({ SWARM: 10, ETH: 0.06, BTC: 0.0012, USD: 25 });
    expect(board.donationCount).toBe(5);
  });

  it("ignores entries with no name, currency or positive amount", () => {
    const board = buildDonorLeaderboard([], [
      { donor: "", amount: 5, currency: "USD", date: "2026-11-20" },
      { donor: "Bob", amount: 0, currency: "USD", date: "2026-11-20" },
      { donor: "Bob", amount: 5, currency: " ", date: "2026-11-20" },
      { donor: "Bob", amount: Number.NaN, currency: "USD", date: "2026-11-20" },
    ]);
    expect(board.donors).toEqual([]);
    expect(board.donationCount).toBe(0);
  });

  it("shows fiat with its symbol and small crypto amounts in full", () => {
    expect(formatDonationAmounts({ USD: 25, BTC: 0.00012, SWARM: 3 })).toBe("3 SWARM · 0.00012 BTC · $25");
  });
});

describe("Support the Vault donations in Credits and synced tokens", () => {
  const vaultGift = (p: Partial<SwarmTransaction>) => tx({
    type: "custom_token_transfer", to: "community-pool", amount: 50,
    meta: { currency: "CREDITS", marketVault: true, direction: "donation" }, ...p,
  });

  it("counts Credits and token donations per contract, but not vault trades", () => {
    const board = buildDonorLeaderboard([
      vaultGift({ from: "alice", amount: 50 }),
      vaultGift({ from: "bob", amount: 3, meta: { currency: "MINTME:0x1234567890abcdef1234567890abcdef12345678", marketVault: true, direction: "donation", ticker: "DREAMS" } }),
      vaultGift({ from: "carol", amount: 7, meta: { currency: "MINTME:0x1234567890abcdef1234567890abcdef12345678", marketVault: true, direction: "donation" } }),
      // A sale to the vault is a trade, not a gift.
      vaultGift({ from: "dave", amount: 9, meta: { currency: "CREDITS", marketVault: true, direction: "vault-buy" } }),
      // Credits paid out of the vault are not a donation either.
      vaultGift({ from: "community-pool", to: "erin", amount: 4, meta: { currency: "CREDITS", marketVault: true, direction: "vault-sell" } }),
    ]);
    // Both gifts are the same contract, so they add up under its symbol.
    expect(board.totals).toEqual({ Credits: 50, DREAMS: 10 });
    expect(board.donors.map((d) => d.userId).sort()).toEqual(["alice", "bob", "carol"]);
  });

  it("never lets a token's label pass itself off as SWARM or Credits", () => {
    const board = buildDonorLeaderboard([
      vaultGift({ from: "mallory", amount: 5, meta: { currency: "MINTME:0xabcdefabcdefabcdefabcdefabcdefabcdef1234", marketVault: true, direction: "donation", ticker: "swarm" } }),
    ]);
    expect(board.totals).toEqual({ "0xabcd…1234": 5 });
  });

  const CONTRACT_A = "MINTME:0xaaaa567890abcdef1234567890abcdef1234aaaa";
  const CONTRACT_B = "MINTME:0xbbbb567890abcdef1234567890abcdef1234bbbb";

  it("never shows a token as dollars, euros or pounds", () => {
    const board = buildDonorLeaderboard(
      [
        vaultGift({ from: "mallory", amount: 40, meta: { currency: CONTRACT_A, marketVault: true, direction: "donation", ticker: "USD" } }),
        vaultGift({ from: "mallory", amount: 2, meta: { currency: CONTRACT_B, marketVault: true, direction: "donation", ticker: "eur" } }),
      ],
      [{ donor: "Ada", amount: 25, currency: "USD", date: "2026-11-01" }],
    );
    expect(board.totals).toEqual({ USD: 25, "0xaaaa…aaaa": 40, "0xbbbb…bbbb": 2 });
    expect(formatDonationAmounts(board.totals)).not.toContain("$40");
  });

  it("keeps two tokens that share a symbol apart", () => {
    const board = buildDonorLeaderboard([
      vaultGift({ from: "alice", amount: 3, meta: { currency: CONTRACT_A, marketVault: true, direction: "donation", ticker: "DREAMS" } }),
      vaultGift({ from: "bob", amount: 5, meta: { currency: CONTRACT_B, marketVault: true, direction: "donation", ticker: "DREAMS" } }),
    ]);
    expect(board.totals).toEqual({ "DREAMS (0xaaaa…aaaa)": 3, "DREAMS (0xbbbb…bbbb)": 5 });
  });

  it("does not let a token merge with a hand-recorded coin of the same name", () => {
    const board = buildDonorLeaderboard(
      [vaultGift({ from: "alice", amount: 3, meta: { currency: CONTRACT_A, marketVault: true, direction: "donation", ticker: "ETH" } })],
      [{ donor: "Ada", amount: 0.05, currency: "ETH", date: "2026-11-01" }],
    );
    expect(board.totals).toEqual({ ETH: 0.05, "ETH (0xaaaa…aaaa)": 3 });
  });

  it("counts a contract once whatever case its address is written in", () => {
    const board = buildDonorLeaderboard([
      vaultGift({ from: "alice", amount: 1, meta: { currency: CONTRACT_A, marketVault: true, direction: "donation", ticker: "DREAMS" } }),
      vaultGift({ from: "alice", amount: 2, meta: { currency: CONTRACT_A.toUpperCase().replace("0X", "0x"), marketVault: true, direction: "donation" } }),
    ]);
    expect(board.totals).toEqual({ DREAMS: 3 });
  });
});

describe("token names this viewer knows", () => {
  it("names an unlabelled token from the viewer's imported tokens, by contract", () => {
    const gift = tx({
      type: "custom_token_transfer", to: "community-pool", from: "bob", amount: 503,
      meta: { currency: "MINTME:0x6343AAAA567890abcdef1234567890abcdef1a82", marketVault: true, direction: "donation" },
    });
    expect(buildDonorLeaderboard([gift], [], { "0x6343aaaa567890abcdef1234567890abcdef1a82": "PURR" }).totals).toEqual({ PURR: 503 });
    expect(buildDonorLeaderboard([gift], [], { "0x6343aaaa567890abcdef1234567890abcdef1a82": "USD" }).totals).toEqual({ "0x6343…1a82": 503 });
  });
});

describe("ranking by market value", () => {
  const TOKEN = "MINTME:0x6343aaaa567890abcdef1234567890abcdef1a82";
  const vaultGift = (from: string, amount: number, currency: string) => tx({
    type: "custom_token_transfer", to: "community-pool", from, amount,
    meta: { currency, marketVault: true, direction: "donation" },
  });

  it("ranks donors by what their gifts are worth, not by raw amounts", () => {
    const board = buildDonorLeaderboard(
      [
        tx({ from: "swarmy", amount: 10, meta: { assetId: "chain:SWARM", ticker: "SWARM" } }),
        // 5,000 Credits at 200 Credits per SWARM is worth 25 SWARM.
        vaultGift("crediter", 5000, "CREDITS"),
        // A big pile of a cheap token is worth little.
        vaultGift("tokener", 1_000_000, TOKEN),
      ],
      [{ donor: "Ada", amount: 1, currency: "ETH", date: "2026-11-01" }],
      {},
      { Credits: 1 / 200, [TOKEN]: 0.000001, ETH: 5000 },
    );
    expect(board.donors.map((d) => [d.userId, d.value])).toEqual([
      ["manual:ada", 5000], ["crediter", 25], ["swarmy", 10], ["tokener", 1],
    ]);
    expect(board.totalValue).toBe(5036);
  });

  it("values a hand-recorded gift at its recorded SWARM worth, and adds nothing for an unpriced asset", () => {
    const board = buildDonorLeaderboard([], [
      { donor: "Gift card", amount: 25, currency: "USD", date: "2026-11-01", swarmValue: 40 },
      { donor: "Mystery", amount: 3, currency: "XYZ", date: "2026-11-01" },
    ]);
    expect(board.donors.map((d) => [d.name, d.value])).toEqual([["Gift card", 40], ["Mystery", 0]]);
  });
});

describe("market value on the board", () => {
  it("rounds big values to whole SWARM and keeps small ones readable", () => {
    expect(formatSwarmValue(2315.4)).toBe("≈ 2,315 SWARM");
    expect(formatSwarmValue(3.14159)).toBe("≈ 3.14 SWARM");
    expect(formatSwarmValue(0.00123)).toBe("≈ 0.0012 SWARM");
  });
});
