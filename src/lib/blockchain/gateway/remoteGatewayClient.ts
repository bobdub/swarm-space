/**
 * Remote Gateway Client — sends JSON-RPC requests to a gateway peer over
 * the existing SwarmMesh channel infrastructure.
 *
 * Reuses `mesh.send('gateway-rpc', ...)` and `mesh.onMessage('gateway-rpc-reply', ...)`.
 * No new sockets, no new registry.
 */
import { getSwarmMeshStandalone } from "@/lib/p2p/swarmMesh.standalone";
import type { RpcRequest } from "./swarmGatewayCell";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();
let replyUnsub: (() => void) | null = null;

const DEFAULT_TIMEOUT_MS = 10_000;

function ensureReplyListener(): void {
  if (replyUnsub) return;
  const mesh = getSwarmMeshStandalone();
  replyUnsub = mesh.onMessage("gateway-rpc-reply", (_peerId: string, payload: unknown) => {
    const msg = payload as { reqId?: string; result?: unknown; error?: { message: string; code?: number } };
    if (!msg?.reqId) return;
    const p = pending.get(msg.reqId);
    if (!p) return;
    pending.delete(msg.reqId);
    clearTimeout(p.timer);
    if (msg.error) {
      const err = new Error(msg.error.message || "Remote gateway error");
      if (msg.error.code != null) (err as { code?: number }).code = msg.error.code;
      p.reject(err);
    } else {
      p.resolve(msg.result);
    }
  });
}

export async function requestRemoteGateway(
  peerId: string,
  req: RpcRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  ensureReplyListener();
  const mesh = getSwarmMeshStandalone();
  const reqId = `grpc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error("Remote gateway timed out"));
    }, timeoutMs);
    pending.set(reqId, { resolve, reject, timer });

    void mesh.send("gateway-rpc", peerId, { reqId, method: req.method, params: req.params }).then((ok) => {
      if (!ok) {
        pending.delete(reqId);
        clearTimeout(timer);
        reject(new Error("Remote gateway unreachable"));
      }
    });
  });
}
