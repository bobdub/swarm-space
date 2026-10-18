import { expect, mock, test } from "bun:test";

const recipient = { id: "aabbccddeeff0011", username: "native-recipient" };
mock.module("@/lib/store", () => ({
  get: async (_store: string, id: string) => id === recipient.id ? recipient : undefined,
  getAll: async () => [recipient],
}));
const { nativeWalletAddress, resolveNativeWalletRecipient } = await import("./nativeAddress");

test("native receiving aliases are stable clean 20-byte addresses without a swarm scheme", async () => {
  expect(await nativeWalletAddress(recipient.id)).toBe("0x68588ba69f51bf95f0e040b0d8f646e9fe526218");
});

test("clean receiving aliases resolve case-insensitively to the existing ledger identity", async () => {
  expect((await resolveNativeWalletRecipient(" 0x68588BA69F51BF95F0E040B0D8F646E9FE526218 ")).id).toBe(recipient.id);
});

test("legacy receiving addresses retain their existing ledger identity", async () => {
  expect((await resolveNativeWalletRecipient("swarm:aabbccddeeff0011")).id).toBe(recipient.id);
  expect((await resolveNativeWalletRecipient("aabbccddeeff0011")).id).toBe(recipient.id);
  await expect(resolveNativeWalletRecipient("swarm:unknown")).rejects.toThrow("recipient not found");
});