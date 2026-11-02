import { describe, it, expect, vi } from "vitest";
import { Wallet } from "ethers";
const held = { value: 0n };
vi.mock("ethers", async (orig) => {
  const real = await orig<typeof import("ethers")>();
  class FakeProvider { async getNetwork() { return { chainId: 24734n }; } async getBalance() { return held.value; } destroy() {} }
  return { ...real, FallbackProvider: FakeProvider, JsonRpcProvider: class {} };
});
import { verifyNativeMintMeDeposit } from "./nativeMintmeCustody";
import { NATIVE_MINTME_CUSTODY, mintMeSyncMessage, nativeMintMeBalanceUnits } from "./nativeMintmeLedger";
import type { SwarmTransaction } from "../types";

const user = "aabbccddeeff0011";
const key = Wallet.createRandom();
const address = key.address.toLowerCase();
async function sync(cumulative: bigint, units: bigint): Promise<SwarmTransaction> {
  return { id: `mintme-sync:${address}:${cumulative}`, type: "external_deposit", from: address, to: user,
    amount: Number(units) / 1e18, chainId: "SWARM", timestamp: "", publicKey: address, nonce: 0, fee: 0,
    signature: await key.signMessage(mintMeSyncMessage(user, address, cumulative, units)),
    meta: { currency: "MINTME", custody: NATIVE_MINTME_CUSTODY, custodyAddress: address, mode: "sync",
      cumulativeUnits: cumulative.toString(), amountUnits: units.toString() } };
}
const E = 10n ** 18n;

describe("direct MintMe deposits without MetaMask", () => {
  it("credits 5 MINTME sent straight to the receiving address", async () => {
    held.value = 5n * E;
    const tx = await sync(5n * E, 5n * E);
    expect(await verifyNativeMintMeDeposit(tx, [], true)).toBe(true);
    expect(nativeMintMeBalanceUnits([tx], user)).toBe(5n * E);
  });
  it("never credits more than the address actually holds", async () => {
    held.value = 5n * E;
    expect(await verifyNativeMintMeDeposit(await sync(6n * E, 6n * E), [], true)).toBe(false);
  });
  it("does not credit the same coins twice", async () => {
    held.value = 5n * E;
    const first = await sync(5n * E, 5n * E);
    expect(await verifyNativeMintMeDeposit(await sync(10n * E, 5n * E), [first], true)).toBe(false);
    held.value = 8n * E;
    expect(await verifyNativeMintMeDeposit(await sync(8n * E, 3n * E), [first], true)).toBe(true);
  });
});
