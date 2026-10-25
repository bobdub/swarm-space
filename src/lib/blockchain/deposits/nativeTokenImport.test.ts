import { beforeEach, describe, it, expect, vi } from "vitest";
import { Interface } from "ethers";

vi.mock("../chain", () => ({ getSwarmChain: vi.fn() }));
vi.mock("../wallets/walletLink", () => ({ _allTransactionsForExternalLedger: () => [], getLinkedWallet: vi.fn() }));
import { importCustomTokenFromMintMe, readTokenMetadataPublic } from "./nativeTokenImport";
import { listCustomTokens } from "./customTokens";

const abi = new Interface(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const token = { address: `0x${"ab".repeat(20)}`, symbol: "ABC", decimals: 18 };

const answeringCall = async (_to: string, data: string) => {
  const name = abi.parseTransaction({ data })?.name;
  if (name === "symbol") return abi.encodeFunctionResult("symbol", ["ABC"]);
  if (name === "decimals") return abi.encodeFunctionResult("decimals", [18]);
  throw new Error(`unexpected call ${name}`);
};

describe("native MintMe token import (no MetaMask)", () => {
  beforeEach(() => localStorage.clear());

  it("reads symbol and decimals from the public nodes", async () => {
    const meta = await readTokenMetadataPublic(token.address, answeringCall);
    expect(meta).toEqual({ symbol: "ABC", decimals: 18 });
  });

  it("returns null fields when the contract does not answer", async () => {
    const meta = await readTokenMetadataPublic(token.address, async () => { throw new Error("unreachable"); });
    expect(meta).toEqual({ symbol: null, decimals: null });
  });

  it("rejects an invalid address without touching the network", async () => {
    const call = vi.fn();
    await expect(readTokenMetadataPublic("not-an-address", call)).rejects.toThrow("valid 0x contract address");
    expect(call).not.toHaveBeenCalled();
  });

  it("saves a valid token to the native watchlist", () => {
    const saved = importCustomTokenFromMintMe("u", token);
    expect(saved.symbol).toBe("ABC");
    expect(listCustomTokens("u")[0]?.address).toBe(token.address);
  });

  it("refuses invalid details and never saves them", () => {
    expect(() => importCustomTokenFromMintMe("u", { ...token, symbol: "bad symbol!" })).toThrow("Check the token");
    expect(() => importCustomTokenFromMintMe("u", { ...token, decimals: 99 })).toThrow("Check the token");
    expect(() => importCustomTokenFromMintMe("", token)).toThrow("Sign in");
    expect(listCustomTokens("u")).toEqual([]);
  });
});
