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
import { transferSwarm } from "../token";
import { Transaction } from "ethers";
import { getGlobalCell } from "@/lib/p2p/globalCell";
import { getSwarmMeshStandalone } from "@/lib/p2p/swarmMesh.standalone";

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

let meshRpcUnsub: (() => void) | null = null;

function startMeshRpcListener(): void {
  if (meshRpcUnsub) return;
  try {
    const mesh = getSwarmMeshStandalone();
    meshRpcUnsub = mesh.onMessage("gateway-rpc", async (peerId: string, payload: unknown) => {
      const msg = payload as { reqId?: string; method?: string; params?: unknown };
      if (!msg?.reqId || !msg?.method) return;
      try {
        const result = await handleRpc({ method: msg.method, params: msg.params as RpcRequest["params"] });
        void mesh.send("gateway-rpc-reply", peerId, { reqId: msg.reqId, result });
      } catch (e) {
        const err = e as { message?: string; code?: number };
        void mesh.send("gateway-rpc-reply", peerId, {
          reqId: msg.reqId,
          error: { message: err?.message ?? "Gateway error", code: err?.code },
        });
      }
    });
  } catch { /* mesh unavailable */ }
}

function stopMeshRpcListener(): void {
  if (meshRpcUnsub) { try { meshRpcUnsub(); } catch { /* ignore */ } meshRpcUnsub = null; }
}

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
  // Announce as a discoverable gateway on the presence beacon and listen
  // for RPC over the mesh channel.
  try { getGlobalCell().setLocalRole("gateway", true); } catch { /* ignore */ }
  startMeshRpcListener();
}

export function stopGatewayCell(): void {
  if (!status.running) return;
  status.running = false;
  emit();
  try { getGlobalCell().setLocalRole("gateway", false); } catch { /* ignore */ }
  stopMeshRpcListener();
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

/**
 * Link an externally-signed EVM address (e.g. the MetaMask account) to the
 * given swarm user id. This lets `eth_getBalance` and `eth_sendRawTransaction`
 * resolve MetaMask's own address back to a swarm identity.
 */
export function linkExternalEvmAddress(swarmId: string, evmAddress: string): void {
  if (!swarmId || !evmAddress) return;
  evmToSwarm.set(evmAddress.toLowerCase(), swarmId);
}

// Map evm tx hash -> swarm tx id, so eth_getTransactionByHash / receipt work
// for txs we forwarded through this gateway.
const evmHashToSwarmTx = new Map<string, {
  swarmTxId: string;
  from: string;
  to: string;
  valueWei: bigint;
  submittedAt: number;
}>();

function findBlockForTx(swarmTxId: string): { blockIndex: number; blockHash: string; txIndex: number } | null {
  const chain = getSwarmChain();
  const blocks = chain.getChain();
  for (const b of blocks) {
    const txs = b.transactions ?? [];
    const idx = txs.findIndex((t) => t.id === swarmTxId);
    if (idx >= 0) return { blockIndex: b.index, blockHash: b.hash, txIndex: idx };
  }
  return null;
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
        const raw = String(params[0] ?? "");
        if (!raw.startsWith("0x")) {
          throw Object.assign(new Error("Missing raw transaction"), { code: -32602 });
        }
        let parsed: Transaction;
        try {
          parsed = Transaction.from(raw);
        } catch (e) {
          throw Object.assign(
            new Error("Could not parse raw transaction: " + (e instanceof Error ? e.message : String(e))),
            { code: -32602 },
          );
        }
        if (parsed.chainId != null && Number(parsed.chainId) !== SWARM_EVM_CHAIN_ID_DEC) {
          throw Object.assign(
            new Error(`Transaction chainId ${parsed.chainId} does not match Swarm-Space (${SWARM_EVM_CHAIN_ID_DEC})`),
            { code: -32000 },
          );
        }
        const fromAddr = (parsed.from ?? "").toLowerCase();
        const toAddr = (parsed.to ?? "").toLowerCase();
        if (!fromAddr) throw Object.assign(new Error("Transaction is not signed"), { code: -32000 });
        if (!toAddr) throw Object.assign(new Error("Contract creation not supported"), { code: -32601 });

        // Ensure current user is mapped so a same-device MetaMask ↔ swarm link
        // exists even before an explicit linkExternalEvmAddress() call.
        const me = getCurrentUser();
        if (me?.id) {
          await ensureMapped(me.id);
          // If we've never seen this MetaMask address before, assume it
          // belongs to the currently-logged-in swarm user. Only the local
          // user could have signed with it in this browser.
          if (!evmToSwarm.has(fromAddr)) evmToSwarm.set(fromAddr, me.id);
        }

        const fromSwarmId = resolveSwarmId(fromAddr);
        if (!fromSwarmId) {
          throw Object.assign(
            new Error("Sender address is not linked to a Swarm identity"),
            { code: -32000 },
          );
        }
        // Recipient: prefer a known swarm identity; otherwise deliver to the
        // raw EVM address as-is so the ledger keeps a durable record.
        const toSwarmId = resolveSwarmId(toAddr) ?? toAddr;

        // Convert wei -> whole SWARM (floor). Below-1-SWARM sends are rejected
        // rather than silently rounded to zero.
        const valueWei = parsed.value ?? 0n;
        const whole = valueWei / 10n ** 18n;
        if (whole <= 0n) {
          throw Object.assign(
            new Error("Amount below 1 SWARM — sub-unit transfers are not yet supported"),
            { code: -32000 },
          );
        }
        const amount = Number(whole);

        const tx = await transferSwarm({
          from: fromSwarmId,
          to: toSwarmId,
          amount,
          meta: { via: "swarm-gateway", evmFrom: fromAddr, evmTo: toAddr, evmHash: parsed.hash },
        });

        const evmHash = (parsed.hash ?? "0x" + tx.id).toLowerCase();
        evmHashToSwarmTx.set(evmHash, {
          swarmTxId: tx.id,
          from: fromAddr,
          to: toAddr,
          valueWei,
          submittedAt: Date.now(),
        });
        try {
          window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } }));
        } catch { /* ignore */ }
        return evmHash;
      }
      case "eth_getTransactionByHash": {
        const hash = String(params[0] ?? "").toLowerCase();
        const rec = evmHashToSwarmTx.get(hash);
        if (!rec) return null;
        const loc = findBlockForTx(rec.swarmTxId);
        return {
          hash,
          from: rec.from,
          to: rec.to,
          value: "0x" + rec.valueWei.toString(16),
          nonce: "0x0",
          gas: "0x5208",
          gasPrice: "0x0",
          input: "0x",
          blockHash: loc ? "0x" + loc.blockHash : null,
          blockNumber: loc ? toHexQuantity(loc.blockIndex) : null,
          transactionIndex: loc ? toHexQuantity(loc.txIndex) : null,
          chainId: SWARM_EVM_CHAIN_ID_HEX,
        };
      }
      case "eth_getTransactionReceipt": {
        const hash = String(params[0] ?? "").toLowerCase();
        const rec = evmHashToSwarmTx.get(hash);
        if (!rec) return null;
        const loc = findBlockForTx(rec.swarmTxId);
        if (!loc) return null; // still pending
        return {
          transactionHash: hash,
          transactionIndex: toHexQuantity(loc.txIndex),
          blockHash: "0x" + loc.blockHash,
          blockNumber: toHexQuantity(loc.blockIndex),
          from: rec.from,
          to: rec.to,
          cumulativeGasUsed: "0x5208",
          gasUsed: "0x5208",
          contractAddress: null,
          logs: [],
          logsBloom: "0x" + "0".repeat(512),
          status: "0x1",
          effectiveGasPrice: "0x0",
          type: "0x0",
        };
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