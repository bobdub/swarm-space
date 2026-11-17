import { beforeEach, describe, expect, it } from "vitest";
import {
  RECENT_NETWORK_LIMIT,
  forgetWalletNetwork,
  loadWalletNetworkPreference,
  networkToChainOption,
  rememberWalletNetwork,
} from "./walletNetworkPreference";

describe("wallet network preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to SWARM with no recent networks", () => {
    expect(loadWalletNetworkPreference("alice")).toEqual({ selected: "swarm", recent: [] });
  });

  it("remembers the selected network across loads, per user", () => {
    rememberWalletNetwork("alice", "mintme");
    expect(loadWalletNetworkPreference("alice").selected).toBe("mintme");
    expect(loadWalletNetworkPreference("bob").selected).toBe("swarm");
  });

  it("keeps recent networks most-recent first without duplicates", () => {
    rememberWalletNetwork("alice", "swarm");
    rememberWalletNetwork("alice", "mintme");
    rememberWalletNetwork("alice", "chain:abc");
    rememberWalletNetwork("alice", "swarm");
    expect(loadWalletNetworkPreference("alice").recent).toEqual(["swarm", "chain:abc", "mintme"]);
  });

  it("caps the recent list", () => {
    for (let i = 0; i < RECENT_NETWORK_LIMIT + 3; i++) rememberWalletNetwork("alice", `chain:c${i}`);
    const { recent } = loadWalletNetworkPreference("alice");
    expect(recent).toHaveLength(RECENT_NETWORK_LIMIT);
    expect(recent[0]).toBe(`chain:c${RECENT_NETWORK_LIMIT + 2}`);
  });

  it("forgets a retired sub-chain and falls back to SWARM", () => {
    rememberWalletNetwork("alice", "mintme");
    rememberWalletNetwork("alice", "chain:gone");
    expect(forgetWalletNetwork("alice", "chain:gone")).toEqual({ selected: "swarm", recent: ["mintme"] });
  });

  it("ignores corrupt stored data", () => {
    window.localStorage.setItem("swarm-space:wallet-network:alice", "{not json");
    expect(loadWalletNetworkPreference("alice")).toEqual({ selected: "swarm", recent: [] });
    window.localStorage.setItem(
      "swarm-space:wallet-network:alice",
      JSON.stringify({ selected: "bogus", recent: ["mintme", 4, "chain:", "mintme"] }),
    );
    expect(loadWalletNetworkPreference("alice")).toEqual({ selected: "swarm", recent: ["mintme"] });
  });

  it("maps wallet networks to picker values", () => {
    expect(networkToChainOption("swarm")).toBe("SWARM");
    expect(networkToChainOption("mintme")).toBe("mintme");
    expect(networkToChainOption("chain:xyz")).toBe("xyz");
  });
});
