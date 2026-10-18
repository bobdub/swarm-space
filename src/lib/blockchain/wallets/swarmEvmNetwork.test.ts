import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const originalFetch = globalThis.fetch;
let rpcResult = "0x123fb";
let rpcUnavailable = false;
globalThis.fetch = (async () => {
  if (rpcUnavailable) throw new Error("Network unavailable");
  return Response.json({ jsonrpc: "2.0", id: 1, result: rpcResult });
}) as typeof fetch;
afterAll(() => { globalThis.fetch = originalFetch; });

const calls: Array<{ method: string; params?: unknown }> = [];
let missingChain = false;
let rejectAdd = false;
mock.module("./metaMaskSdk", () => ({
  getExternalMetaMaskProvider: async () => ({
    request: async (args: { method: string; params?: unknown }) => {
      calls.push(args);
      if (args.method === "wallet_switchEthereumChain" && missingChain) {
        missingChain = false;
        throw { code: 4902 };
      }
      if (args.method === "wallet_addEthereumChain" && rejectAdd) throw { code: 4001 };
      return null;
    },
  }),
}));
const { addSwarmNetworkToMetaMask, switchToSwarmNetwork } = await import("./swarmEvmNetwork");

beforeEach(() => { calls.length = 0; missingChain = false; rejectAdd = false; rpcResult = "0x123fb"; rpcUnavailable = false; });

test("registers SWARM with the external wallet and the canonical chain ID", async () => {
  await addSwarmNetworkToMetaMask();
  expect(calls).toEqual([{
    method: "wallet_addEthereumChain",
    params: [{ chainId: "0x123fb", chainName: "Swarm-Space", nativeCurrency: { name: "SWARM", symbol: "SWARM", decimals: 18 }, rpcUrls: ["https://rpc.swarm-space.lovable.app"], blockExplorerUrls: ["https://swarm-space.lovable.app/explorer"] }],
  }]);
});

test("switches again after registering a missing network", async () => {
  missingChain = true;
  await switchToSwarmNetwork();
  expect(calls.map(c => c.method)).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);
});

test("does not report successful registration when MetaMask declines", async () => {
  rejectAdd = true;
  await expect(addSwarmNetworkToMetaMask()).rejects.toEqual({ code: 4001 });
});

test("never asks MetaMask to install when the public RPC is unreachable", async () => {
  rpcUnavailable = true;
  await expect(addSwarmNetworkToMetaMask()).rejects.toThrow("could not be verified");
  expect(calls).toHaveLength(0);
});

test("never switches MetaMask when the public chain ID is not SWARM", async () => {
  rpcResult = "0x1";
  await expect(switchToSwarmNetwork()).rejects.toThrow("does not match SWARM");
  expect(calls).toHaveLength(0);
});