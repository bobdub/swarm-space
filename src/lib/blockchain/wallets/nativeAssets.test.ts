import { describe, expect, it } from "vitest";
import { nativeMarketPayments, nativeWalletAssets, type NativeAssetSnapshot } from "./nativeAssets";

const base: NativeAssetSnapshot = { swarm: 12, credits: 0, mintme: 0, eth: 0, btc: 0, custom: [], holdings: [] };

describe("Native Market payment ownership", () => {
  it("includes the SWARM-deployed token held in Native", () => {
    const assets = nativeWalletAssets({ ...base, holdings: [{ userId: "mike", tokenId: "deployed", ticker: "MIKE", creatorUserId: "mike", amount: 1000, lastUpdated: "2026-10-21" }] });
    expect(nativeMarketPayments(assets).map(({ id, amount }) => ({ id, amount }))).toEqual([{ id: "creator:deployed", amount: 1000 }]);
  });
  it("excludes zero balances and SWARM from Buy", () => {
    expect(nativeMarketPayments(nativeWalletAssets(base))).toEqual([]);
  });
  it("uses Native deposited balances, not import metadata or an external price", () => {
    const token = { address: "0x" + "a".repeat(40), symbol: "MTCG", decimals: 18, addedAt: 0 };
    const assets = nativeWalletAssets({ ...base, custom: [{ token, amount: 100, available: 0 }, { token: { ...token, address: "0x" + "b".repeat(40) }, amount: 0, available: 0 }] });
    expect(nativeMarketPayments(assets).map(({ id, amount, available }) => ({ id, amount, available }))).toEqual([{ id: `custom:${token.address}`, amount: 100, available: 0 }]);
  });
  it("includes only positive Credits and native coin balances", () => {
    expect(nativeMarketPayments(nativeWalletAssets({ ...base, credits: 50, mintme: 2, eth: 0, btc: NaN })).map(({ id }) => id)).toEqual(["CREDIT", "MINTME"]);
  });
});