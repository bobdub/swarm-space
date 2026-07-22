/**
 * Swarm Gateway Cell — a translator that sits inside the mesh and answers
 * JSON-RPC on behalf of the Swarm blockchain.
 *
 * The gateway is NOT the chain. It only reads local mesh state (the same
 * state every peer already has) and re-expresses it in the shape MetaMask
 * expects. Phase A implements read-only methods so MetaMask can *see*
 * Swarm-Space. Signing / sending is Phase B.
 */

import { getSwarmChain } from "../chain";
import { getCurrentUser } from "@/lib/auth";
import { SWARM_EVM_CHAIN_ID_HEX, SWARM_EVM_CHAIN_ID_DEC } from "../wallets/swarmEvmNetwork";
import { swarmIdToEvmAddress, peekEvmAddress, swarmToWeiHex } from "./addressMap";

export interface RpcRequest {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

export interface GatewayStatus {
  running: boolean;
  requestsServed: number;
  lastError: string | null;
  lastMethod: string | null;
  lastAt: number | null;
}

const status: GatewayStatus = {
  running: false,
  requestsServed: 0,
  lastError: null,
  lastMethod: null,
  lastAt: null,
};

const listeners = new Set<(s: GatewayStatus) => void>();

function emit(): void {
  const snap: GatewayStatus = { ...status };
  for (const fn of listeners) {
    try { fn(snap); } catch { /* ignore */ }
  }
}

export function subscribeGatewayStatus(fn: (s: GatewayStatus) => void): () => void {
  listeners.add(fn);
  fn({ ...status });
  return () => { listeners.delete(fn); };
}

export function getGatewayStatus(): GatewayStatus {
  return { ...status };
}

export function startGatewayCell(): void {
  if (status.running) return;
  status.running = true;
  emit();
  // Warm the address map for the current user so peekEvmAddress works.
  const me = getCurrentUser();
  if (me?.id) { void swarmIdToEvmAddress(me.id); }
}

export function stopGatewayCell(): void {
  if (!status.running) return;
  status.running = false;
  emit();
}

// --- reverse lookup: EVM address (lower-cased) → swarm user id -------------
// The gateway only knows the mapping for identities it has seen. That is
// enough for Phase A because MetaMask queries balances against addresses
// derived from the local user.
const evmToSwarm = new Map<string, string>();

async function ensureMapped(swarmId: string): Promise<string> {
  const addr = (await swarmIdToEvmAddress(swarmId)).toLowerCase();
  evmToSwarm.set(addr, swarmId);
  return addr;
}

function resolveSwarmId(evmAddress: string): string | null {
  const key = evmAddress.toLowerCase();
  return evmToSwarm.get(key) ?? null;
}

// --- block adapters --------------------------------------------------------

function toHexQuantity(n: number | bigint): string {
  const v = typeof n === "bigint" ? n : BigInt(Math.floor(n));
  return "0x" + v.toString(16);
}

function blockToEthShape(block: import("../types").SwarmBlock) {
  return {
    number: toHexQuantity(block.index),
    hash: "0x" + block.hash,
    parentHash: "0x" + block.previousHash,
    timestamp: toHexQuantity(Math.floor(new Date(block.timestamp).getTime() / 1000)),
    nonce: toHexQuantity(block.nonce ?? 0),
    difficulty: toHexQuantity(block.difficulty ?? 0),
    gasLimit: "0x0",
    gasUsed: "0x0",
    miner: "0x0000000000000000000000000000000000000000",
    transactions: block.transactions.map((tx, i) => tx.id ?? `swarm-${block.index}-${i}`),
    size: "0x0",
    extraData: "0x",
  };
}

// --- the RPC handler -------------------------------------------------------

export async function handleRpc(req: RpcRequest): Promise<unknown> {
  if (!status.running) {
    throw Object.assign(new Error("Swarm gateway is not running"), { code: -32603 });
  }
  status.lastMethod = req.method;
  status.lastAt = Date.now();
  status.requestsServed++;

  try {
    const params = Array.isArray(req.params) ? req.params : [];
    switch (req.method) {
      case "eth_chainId":
        return SWARM_EVM_CHAIN_ID_HEX;
      case "net_version":
        return String(SWARM_EVM_CHAIN_ID_DEC);
      case "eth_gasPrice":
        return "0x0"; // SWARM has no gas market inside the mesh
      case "eth_estimateGas":
        return "0x5208"; // 21000 — nominal for a transfer
      case "web3_clientVersion":
        return "SwarmGatewayCell/0.1";
      case "eth_blockNumber": {
        const chain = getSwarmChain();
        await chain.whenReady();
        const tip = chain.getChain().at(-1);
        return toHexQuantity(tip?.index ?? 0);
      }
      case "eth_accounts":
      case "eth_requestAccounts": {
        const me = getCurrentUser();
        if (!me?.id) return [];
        return [await ensureMapped(me.id)];
      }
      case "eth_getBalance": {
        const addrParam = String(params[0] ?? "").toLowerCase();
        // Make sure the current user's mapping is populated so a direct
        // MetaMask query resolves.
        const me = getCurrentUser();
        if (me?.id) await ensureMapped(me.id);
        const swarmId = resolveSwarmId(addrParam);
        if (!swarmId) return "0x0";
        const chain = getSwarmChain();
        await chain.whenReady();
        const bal = chain.getBalance(swarmId);
        return swarmToWeiHex(bal);
      }
      case "eth_getBlockByNumber": {
        const chain = getSwarmChain();
        await chain.whenReady();
        const list = chain.getChain();
        const which = String(params[0] ?? "latest");
        let block: import("../types").SwarmBlock | undefined;
        if (which === "latest" || which === "pending" || which === "safe" || which === "finalized") {
          block = list.at(-1);
        } else if (which === "earliest") {
          block = list[0];
        } else {
          const idx = Number.parseInt(which, 16);
          block = Number.isFinite(idx) ? list[idx] : undefined;
        }
        return block ? blockToEthShape(block) : null;
      }
      case "eth_getBlockByHash": {
        const chain = getSwarmChain();
        await chain.whenReady();
        const target = String(params[0] ?? "").replace(/^0x/, "");
        const block = chain.getChain().find((b) => b.hash === target);
        return block ? blockToEthShape(block) : null;
      }
      case "eth_getTransactionCount":
        return "0x0"; // Nonces aren't tracked in Phase A
      case "eth_sendRawTransaction": {
        const err = new Error("Sending is coming in Phase B — signed tx forwarding not enabled");
        (err as { code?: number }).code = -32601;
        throw err;
      }
      case "eth_subscribe":
      case "eth_unsubscribe": {
        const err = new Error("Subscriptions are not supported by the Swarm gateway");
        (err as { code?: number }).code = -32601;
        throw err;
      }
      default: {
        const err = new Error(`Method ${req.method} not supported by Swarm gateway`);
        (err as { code?: number }).code = -32601;
        throw err;
      }
    }
  } catch (e) {
    status.lastError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    emit();
  }
}

/** Convenience: seed the reverse map for the given swarm id. */
export async function registerLocalIdentity(swarmId: string): Promise<string> {
  return ensureMapped(swarmId);
}

export { peekEvmAddress };