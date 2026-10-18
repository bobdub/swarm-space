import { expect, test } from "bun:test";
import { validatePublicRpc } from "./publicRpcValidation";

const url = "https://rpc.swarm-space.lovable.app";
const reply = (body: unknown) => (async () => Response.json(body)) as typeof fetch;

test("checks eth_chainId by HTTPS POST without wallet access", async () => {
  let request: RequestInit | undefined;
  const http = (async (input, init) => {
    expect(input).toBe(`${url}/`);
    request = init;
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x123FB" });
  }) as typeof fetch;
  await validatePublicRpc(url, "0x123fb", http);
  expect(request?.method).toBe("POST");
  expect(JSON.parse(String(request?.body))).toEqual({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
  expect(request?.credentials).toBe("omit");
});

test("rejects non-HTTPS URLs before making a request", async () => {
  let called = false;
  const http = (async () => { called = true; return new Response(); }) as typeof fetch;
  await expect(validatePublicRpc("http://localhost:8545", "0x123fb", http)).rejects.toThrow("public HTTPS");
  expect(called).toBe(false);
});

test("rejects JSON-RPC errors even if they contain the expected result", async () => {
  await expect(validatePublicRpc(url, "0x123fb", reply({ jsonrpc: "2.0", id: 1, result: "0x123fb", error: { code: -32603 } }))).rejects.toThrow("valid eth_chainId");
});

test("rejects mismatched JSON-RPC response IDs", async () => {
  await expect(validatePublicRpc(url, "0x123fb", reply({ jsonrpc: "2.0", id: 2, result: "0x123fb" }))).rejects.toThrow("valid eth_chainId");
});

test("rejects a static HTML app page", async () => {
  const http = (async () => new Response("<!doctype html><title>SWARM</title>")) as typeof fetch;
  await expect(validatePublicRpc(url, "0x123fb", http)).rejects.toThrow("could not be verified");
});

test("rejects an HTTP failure even when its body claims the expected chain", async () => {
  const http = (async () => Response.json({ jsonrpc: "2.0", id: 1, result: "0x123fb" }, { status: 503 })) as typeof fetch;
  await expect(validatePublicRpc(url, "0x123fb", http)).rejects.toThrow("HTTP 503");
});