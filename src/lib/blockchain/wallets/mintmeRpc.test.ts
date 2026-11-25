import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FallbackProvider, JsonRpcProvider, type JsonRpcPayload } from "ethers";
import { MINTME_CHAIN_ID_DEC, MINTME_CHAIN_ID_HEX, MINTME_NETWORK } from "./mintmeNetwork";
import { mintMeFallbackProvider, mintMeJsonRpcProvider } from "./mintmeRpc";

/** Every public node answers as a real MintMe node would. */
function answer(p: JsonRpcPayload) {
  const result = p.method === "eth_chainId" ? MINTME_CHAIN_ID_HEX
    : p.method === "eth_blockNumber" ? "0x10"
    : p.method === "eth_getBalance" ? "0xde0b6b3a7640000"
    : null;
  return { id: p.id, result };
}

describe("MintMe RPC providers", () => {
  beforeEach(() => {
    vi.spyOn(JsonRpcProvider.prototype, "_send").mockImplementation(async (payload) =>
      (Array.isArray(payload) ? payload : [payload]).map(answer));
  });
  afterEach(() => vi.restoreAllMocks());

  it("reproduces the bug: quorum passed as the network pins Ethereum mainnet", async () => {
    const old = new FallbackProvider(
      MINTME_NETWORK.rpcUrls.map((url) => ({ provider: new JsonRpcProvider(url), priority: 1, stallTimeout: 1500 })),
      1,
    );
    try {
      await expect(old.getBalance("0x0000000000000000000000000000000000000001"))
        .rejects.toThrow(`network changed: 1 => ${MINTME_CHAIN_ID_DEC}`);
    } finally { old.destroy(); }
  });

  it("reads MintMe balances on chain 24734", async () => {
    const provider = mintMeFallbackProvider();
    try {
      expect((await provider.getNetwork()).chainId).toBe(BigInt(MINTME_CHAIN_ID_DEC));
      expect(await provider.getBalance("0x0000000000000000000000000000000000000001")).toBe(10n ** 18n);
      expect(provider.quorum).toBe(1);
      expect(provider.providerConfigs).toHaveLength(MINTME_NETWORK.rpcUrls.length);
    } finally { provider.destroy(); }
  });

  it("clamps quorum to the number of nodes", () => {
    const provider = mintMeFallbackProvider(99);
    try { expect(provider.quorum).toBe(MINTME_NETWORK.rpcUrls.length); } finally { provider.destroy(); }
  });

  it("gives each node a static MintMe network so it never re-detects", async () => {
    const node = mintMeJsonRpcProvider(MINTME_NETWORK.rpcUrls[0]);
    try { expect((await node.getNetwork()).chainId).toBe(BigInt(MINTME_CHAIN_ID_DEC)); } finally { node.destroy(); }
  });
});
