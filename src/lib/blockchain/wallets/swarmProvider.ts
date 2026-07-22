/**
 * In-browser EIP-1193 provider backed by the Swarm Gateway Cell.
 */
import { handleRpc, startGatewayCell } from "../gateway/swarmGatewayCell";
import { SWARM_EVM_CHAIN_ID_HEX } from "./swarmEvmNetwork";
import type { Eip1193Provider } from "./metaMaskSdk";

type Listener = (...args: unknown[]) => void;
const listeners: Record<string, Set<Listener>> = {};

function on(event: string, handler: Listener): void {
  (listeners[event] ??= new Set()).add(handler);
}
function removeListener(event: string, handler: Listener): void {
  listeners[event]?.delete(handler);
}

export const swarmEip1193Provider: Eip1193Provider = {
  isMetaMask: false,
  async request({ method, params }) {
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