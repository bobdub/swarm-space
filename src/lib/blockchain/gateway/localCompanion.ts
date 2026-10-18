/** Only this loopback endpoint is trusted; health is not a chain preflight. */
export const COMPANION_URL = "http://127.0.0.1:8545";
export const COMPANION_PROTOCOL = "swarm-local-companion-v1";
export type CompanionHealth = { protocol: string; version: string; bridgeReady: boolean };

export async function detectCompanion(http: typeof fetch = fetch): Promise<CompanionHealth> {
  const response = await http(`${COMPANION_URL}/health`, {
    signal: AbortSignal.timeout(2500), cache: "no-store", credentials: "omit", redirect: "error",
  });
  if (!response.ok) throw new Error("Local companion did not respond.");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object") throw new Error("Not a SWARM companion.");
  const health = data as Record<string, unknown>;
  if (health.protocol !== COMPANION_PROTOCOL || health.version !== "1.0.0" || typeof health.bridgeReady !== "boolean") {
    throw new Error("Unrecognized companion. Download the current version.");
  }
  return health as CompanionHealth;
}

export async function verifyCompanionRpc(http: typeof fetch = fetch): Promise<void> {
  const response = await http(`${COMPANION_URL}/rpc`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  const data: unknown = await response.json();
  const reply = data && typeof data === "object" ? data as Record<string, unknown> : null;
  if (!response.ok || reply?.jsonrpc !== "2.0" || reply.id !== 1 || "error" in reply || reply.result !== "0x123fb") {
    throw new Error("The paired mesh did not verify SWARM chain 74747.");
  }
}

// No signing, account authorization or transaction submission through this scaffold.
const READ_METHODS = new Set([
  "eth_chainId", "net_version", "web3_clientVersion", "eth_blockNumber",
  "eth_getBalance", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_gasPrice",
]);
export function isCompanionReadMethod(method: string): boolean { return READ_METHODS.has(method); }

type RelayRequest = { id: string; method: string; params?: unknown[] };
export async function runCompanionRelay(
  pairingCode: string,
  signal: AbortSignal,
  handleRead: (request: { method: string; params?: unknown[] }) => Promise<unknown>,
  onPaired: () => void,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(pairingCode)) throw new Error("Enter the pairing code shown by your companion.");
  const headers = { Authorization: `Bearer ${pairingCode}`, "Content-Type": "application/json" };
  while (!signal.aborted) {
    const poll = await fetch(`${COMPANION_URL}/bridge/poll`, {
      headers, signal, credentials: "omit", cache: "no-store", redirect: "error",
    });
    if (!poll.ok) throw new Error(poll.status === 401 ? "Pairing code did not match." : "Companion connection lost.");
    onPaired();
    const requests: RelayRequest[] = await poll.json();
    for (const request of requests) {
      let result: unknown;
      let error: { code: number; message: string } | undefined;
      try {
        if (!isCompanionReadMethod(request.method)) throw new Error("Method not supported by the read-only companion.");
        result = await handleRead(request);
      } catch (cause) {
        error = { code: -32601, message: cause instanceof Error ? cause.message : "Mesh read failed." };
      }
      const reply = await fetch(`${COMPANION_URL}/bridge/reply`, {
        method: "POST", headers, signal, credentials: "omit", redirect: "error",
        body: JSON.stringify({ id: request.id, result, error }),
      });
      if (!reply.ok) throw new Error("Companion rejected the mesh reply.");
    }
  }
}