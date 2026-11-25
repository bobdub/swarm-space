import { describe, expect, it } from "vitest";
import type { SwarmTransaction } from "../types";
import { buildDonorLeaderboard, formatDonationAmounts } from "./donorLeaderboard";
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
    expect(board.totals).toEqual({ MINTME: 3, "token:eve-coin": 9, FOX: 4 });
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

  it("counts Credits and named token donations, but not vault trades", () => {
    const board = buildDonorLeaderboard([
      vaultGift({ from: "alice", amount: 50 }),
      vaultGift({ from: "bob", amount: 3, meta: { currency: "MINTME:0x1234567890abcdef1234567890abcdef12345678", marketVault: true, direction: "donation", ticker: "DREAMS" } }),
      vaultGift({ from: "carol", amount: 7, meta: { currency: "MINTME:0x1234567890abcdef1234567890abcdef12345678", marketVault: true, direction: "donation" } }),
      // A sale to the vault is a trade, not a gift.
      vaultGift({ from: "dave", amount: 9, meta: { currency: "CREDITS", marketVault: true, direction: "vault-buy" } }),
      // Credits paid out of the vault are not a donation either.
      vaultGift({ from: "community-pool", to: "erin", amount: 4, meta: { currency: "CREDITS", marketVault: true, direction: "vault-sell" } }),
    ]);
    expect(board.totals).toEqual({ Credits: 50, DREAMS: 3, "0x1234…5678": 7 });
    expect(board.donors.map((d) => d.userId).sort()).toEqual(["alice", "bob", "carol"]);
  });

  it("never lets a token's label pass itself off as SWARM or Credits", () => {
    const board = buildDonorLeaderboard([
      vaultGift({ from: "mallory", amount: 5, meta: { currency: "MINTME:0xabcdefabcdefabcdefabcdefabcdefabcdef1234", marketVault: true, direction: "donation", ticker: "swarm" } }),
    ]);
    expect(board.totals).toEqual({ "0xabcd…1234": 5 });
  });
});
