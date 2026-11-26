import { beforeEach, describe, expect, it } from "vitest";
import { forgetWalletNetwork, loadWalletNetwork, rememberWalletNetwork } from "./walletNetworkPreference";

describe("wallet network preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to SWARM", () => {
    expect(loadWalletNetwork("alice")).toBe("swarm");
  });

  it("remembers the selected network across loads, per user", () => {
    rememberWalletNetwork("alice", "mintme");
    expect(loadWalletNetwork("alice")).toBe("mintme");
    rememberWalletNetwork("alice", "ethereum");
    expect(loadWalletNetwork("alice")).toBe("ethereum");
    rememberWalletNetwork("alice", "mintme");
    expect(loadWalletNetwork("bob")).toBe("swarm");
    rememberWalletNetwork("alice", "chain:abc");
    expect(loadWalletNetwork("alice")).toBe("chain:abc");
  });

  it("forgets a retired sub-chain and falls back to SWARM", () => {
    rememberWalletNetwork("alice", "chain:gone");
    forgetWalletNetwork("alice");
    expect(loadWalletNetwork("alice")).toBe("swarm");
  });

  it("ignores invalid stored values", () => {
    window.localStorage.setItem("swarm-space:wallet-network:alice", "bogus");
    expect(loadWalletNetwork("alice")).toBe("swarm");
    window.localStorage.setItem("swarm-space:wallet-network:alice", "chain:");
    expect(loadWalletNetwork("alice")).toBe("swarm");
  });
});
