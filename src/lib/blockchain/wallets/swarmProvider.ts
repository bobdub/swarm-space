/**
 * In-browser EIP-1193 provider backed by the Swarm Gateway Cell.
 */
import { handleRpc, startGatewayCell } from "../gateway/swarmGatewayCell";
import { SWARM_EVM_CHAIN_ID_HEX } from "./swarmEvmNetwork";
import type { Eip1193Provider } from "./metaMaskSdk";
import { requestRemoteGateway } from "../gateway/remoteGatewayClient";

type Listener = (...args: unknown[]) => void;
const listeners: Record<string, Set<Listener>> = {};

let remoteTarget: string | null = null;
const remoteListeners = new Set<(peerId: string | null) => void>();

export function setRemoteGateway(peerId: string | null): void {
  remoteTarget = peerId && peerId.length > 0 ? peerId : null;
  for (const fn of remoteListeners) { try { fn(remoteTarget); } catch { /* ignore */ } }
}
export function clearRemoteGateway(): void { setRemoteGateway(null); }
export function getRemoteGateway(): string | null { return remoteTarget; }
export function subscribeRemoteGateway(fn: (peerId: string | null) => void): () => void {
  remoteListeners.add(fn);
  try { fn(remoteTarget); } catch { /* ignore */ }
  return () => { remoteListeners.delete(fn); };
}

function on(event: string, handler: Listener): void {
  (listeners[event] ??= new Set()).add(handler);
}
function removeListener(event: string, handler: Listener): void {
  listeners[event]?.delete(handler);
}

export const swarmEip1193Provider: Eip1193Provider = {
  isMetaMask: false,
  async request({ method, params }) {
    if (remoteTarget) {
      try {
        return await requestRemoteGateway(remoteTarget, { method, params });
      } catch (e) {
        // Fall back to local gateway if remote is unreachable.
        console.warn("[swarmProvider] Remote gateway failed, falling back to local:", e);
        setRemoteGateway(null);
      }
    }
    startGatewayCell();
    return handleRpc({ method, params });
  },
  on,
  removeListener,
};

export function announceSwarmChain(): void {
  const fns = listeners["chainChanged"];
  if (!fns) return;
  for (const fn of fns) {
    try { fn(SWARM_EVM_CHAIN_ID_HEX); } catch { /* ignore */ }
  }
}