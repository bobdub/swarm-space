import { beforeEach, expect, mock, test } from "bun:test";

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

beforeEach(() => { calls.length = 0; missingChain = false; rejectAdd = false; });

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