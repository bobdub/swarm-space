/** HTTP-only preflight. Never calls an injected or in-browser wallet provider. */
export async function validatePublicRpc(
  rpcUrl: string,
  expectedChainId: string,
  fetchRpc: typeof fetch = fetch,
): Promise<void> {
  const url = new URL(rpcUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("SWARM network installation requires a public HTTPS RPC URL.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchRpc(url.href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}.`);
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") throw new Error("RPC did not return JSON-RPC.");
    const reply = data as Record<string, unknown>;
    if (reply.jsonrpc !== "2.0" || reply.id !== 1 || "error" in reply ||
        typeof reply.result !== "string" || !/^0x[0-9a-f]+$/i.test(reply.result)) {
      throw new Error("RPC did not return a valid eth_chainId response.");
    }
    if (BigInt(reply.result) !== BigInt(expectedChainId)) {
      throw new Error(`RPC chain ID ${reply.result} does not match SWARM (${expectedChainId}).`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Request failed.";
    throw new Error(`SWARM public RPC could not be verified. ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}