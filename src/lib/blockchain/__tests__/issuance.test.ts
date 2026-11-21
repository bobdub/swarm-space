import { describe, expect, it } from "vitest";
import { blockForbidsSelfMints, isRewardMature, isSelfIssuedSwarmMint, SELF_MINT_CUTOFF_MS } from "../issuance";

describe("issuance rules", () => {
  it("spots only SWARM mints a device issued to itself", () => {
    expect(isSelfIssuedSwarmMint({ type: "token_mint", from: "system" })).toBe(true);
    expect(isSelfIssuedSwarmMint({ type: "token_mint", from: "system", tokenId: "tok" })).toBe(false);
    expect(isSelfIssuedSwarmMint({ type: "token_mint", from: "alice" })).toBe(false);
    expect(isSelfIssuedSwarmMint({ type: "mining_reward", from: "system" })).toBe(false);
    expect(isSelfIssuedSwarmMint({ type: "pool_donate", from: "system" })).toBe(true);
    expect(isSelfIssuedSwarmMint({ type: "pool_donate", from: "alice" })).toBe(false);
    expect(isSelfIssuedSwarmMint({ type: "nft_mint", from: "system" })).toBe(false);
  });

  it("forbids self mints from the cutoff on, and in blocks with an unreadable stamp", () => {
    expect(blockForbidsSelfMints({ timestamp: new Date(SELF_MINT_CUTOFF_MS - 1).toISOString() })).toBe(false);
    expect(blockForbidsSelfMints({ timestamp: new Date(SELF_MINT_CUTOFF_MS).toISOString() })).toBe(true);
    expect(blockForbidsSelfMints({ timestamp: "not a date" })).toBe(true);
  });

  it("matures a reward once 20 blocks sit on top of it", () => {
    expect(isRewardMature(5, 25)).toBe(false);
    expect(isRewardMature(5, 26)).toBe(true);
  });
});
