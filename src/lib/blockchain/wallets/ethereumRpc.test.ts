import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonRpcProvider, type JsonRpcPayload } from "ethers";
import { ETHEREUM_CHAIN_ID_DEC, ETHEREUM_NETWORK } from "./ethereumNetwork";
import { ethereumFallbackProvider } from "./ethereumRpc";
import { mintMeFallbackProvider } from "./mintmeRpc";
import { MINTME_CHAIN_ID_DEC } from "./mintmeNetwork";

let chainIdHex = "0x1";
function answer(p: JsonRpcPayload) {
  const result = p.method === "eth_chainId" ? chainIdHex
    : p.method === "eth_blockNumber" ? "0x10"
    : p.method === "eth_getBalance" ? "0xde0b6b3a7640000"
    : null;
  return { id: p.id, result };
}

describe("Ethereum RPC providers", () => {
  beforeEach(() => {
    chainIdHex = "0x1";
    vi.spyOn(JsonRpcProvider.prototype, "_send").mockImplementation(async (payload) =>
      (Array.isArray(payload) ? payload : [payload]).map(answer));
  });
  afterEach(() => vi.restoreAllMocks());

  it("is pinned to chain 1 across every public node", async () => {
    const provider = ethereumFallbackProvider();
    try {
      expect((await provider.getNetwork()).chainId).toBe(BigInt(ETHEREUM_CHAIN_ID_DEC));
      expect(await provider.getBalance("0x0000000000000000000000000000000000000001")).toBe(10n ** 18n);
      expect(provider.quorum).toBe(1);
      expect(provider.providerConfigs).toHaveLength(ETHEREUM_NETWORK.rpcUrls.length);
    } finally { provider.destroy(); }
  });

  it("shares the per-chain helper with MintMe without crossing chains", async () => {
    const eth = ethereumFallbackProvider();
    const mintme = mintMeFallbackProvider();
    try {
      expect((await eth.getNetwork()).chainId).toBe(1n);
      expect((await mintme.getNetwork()).chainId).toBe(BigInt(MINTME_CHAIN_ID_DEC));
    } finally { eth.destroy(); mintme.destroy(); }
  });

  it("uses only public https endpoints", () => {
    for (const url of ETHEREUM_NETWORK.rpcUrls) expect(url).toMatch(/^https:\/\/[^/]+/);
    expect(new Set(ETHEREUM_NETWORK.rpcUrls).size).toBe(ETHEREUM_NETWORK.rpcUrls.length);
  });
});
