import { expect, mock, test } from "bun:test";

const recipient = { id: "aabbccddeeff0011", username: "native-recipient" };
mock.module("@/lib/store", () => ({
  get: async (_store: string, id: string) => id === recipient.id ? recipient : undefined,
  getAll: async () => [recipient],
}));
const { nativeWalletAddress, resolveNativeWalletRecipient } = await import("./nativeAddress");

test("native SWARM receiving addresses resolve to the existing identity without an external wallet", async () => {
  expect(nativeWalletAddress(recipient.id)).toBe("swarm:aabbccddeeff0011");
  expect((await resolveNativeWalletRecipient("swarm:aabbccddeeff0011")).id).toBe(recipient.id);
  await expect(resolveNativeWalletRecipient("swarm:unknown")).rejects.toThrow("recipient not found");
});