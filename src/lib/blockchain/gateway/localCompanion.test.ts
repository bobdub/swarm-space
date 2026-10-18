import { expect, test } from "bun:test";
import { detectCompanion, verifyCompanionRpc, isCompanionReadMethod } from "./localCompanion";
const http = (body: unknown) => (async () => Response.json(body)) as typeof fetch;
test("recognizes the local companion without calling it a live mesh", async () => {
  expect((await detectCompanion(http({ protocol: "swarm-local-companion-v1", version: "1.0.0", bridgeReady: false }))).bridgeReady).toBe(false);
});
test("rejects unrelated loopback services", async () => {
  await expect(detectCompanion(http({ protocol: "other", version: "1.0.0", bridgeReady: true }))).rejects.toThrow("Unrecognized");
});
test("requires a real chain-ID reply before offering local installation", async () => {
  await verifyCompanionRpc(http({ jsonrpc: "2.0", id: 1, result: "0x123fb" }));
  await expect(verifyCompanionRpc(http({ jsonrpc: "2.0", id: 1, result: "0x1" }))).rejects.toThrow("74747");
  await expect(verifyCompanionRpc(http({ jsonrpc: "2.0", id: 1, result: "0x123fb", error: {} }))).rejects.toThrow("74747");
});
test("the companion never exposes signing, linking or send methods", () => {
  for (const method of ["personal_sign", "eth_sendRawTransaction", "eth_sendTransaction", "eth_requestAccounts", "eth_accounts"]) {
    expect(isCompanionReadMethod(method)).toBe(false);
  }
  expect(isCompanionReadMethod("eth_getBalance")).toBe(true);
});