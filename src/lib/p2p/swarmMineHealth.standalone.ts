/**
 * ═══════════════════════════════════════════════════════════════════════
 * MINING AS MOTION — Network-Stabilizing Block Production Protocol
 * ═══════════════════════════════════════════════════════════════════════
 *
 * This module documents the "Mining as Motion" protocol that transforms
 * passive mining into active mesh maintenance. The implementation lives
 * directly in swarmMesh.standalone.ts (where private member access is
 * required), but this file serves as the protocol specification and
 * type definitions for the enriched mining messages.
 *
 * ── How It Works ───────────────────────────────────────────────────────
 *
 * 1. ENRICHED MINING BROADCAST (every 15s)
 *    Each mined block carries network metadata:
 *    - peerCount: mesh density gauge
 *    - librarySnapshot: up to 5 peer IDs for passive PEX
 *    - uptime: node stability indicator
 *    - blockHeight: cumulative blocks mined (consistency check)
 *    - minedAt: timestamp for RTT measurement via mining-ack
 *
 * 2. MINING-ACK (response to blockchain-tx)
 *    Receiving peers respond with:
 *    - blockHeight: their own cumulative total
 *    - peerCount: their connection count
 *    - echoMinedAt: echoed timestamp for RTT calculation
 *    Round-trip from broadcast → ack = connection quality metric.
 *
 * 3. LIVENESS SIGNALS
 *    Incoming mining broadcasts update lastActivity AND lastMinedBlock
 *    on the sending peer. Mining peers get an extended stale threshold
 *    (60s vs 30s) since their blocks prove liveness.
 *
 * 4. PASSIVE PEX (Peer Exchange)
 *    librarySnapshot in each block carries up to 5 peer IDs.
 *    Receiving peers learn about unknown nodes and auto-dial them —
 *    same effect as library-exchange but piggybacks on mining with
 *    zero extra messages.
 *
 * 5. MINING-DRIVEN RECONNECTION
 *    Library reconnect loop sorts candidates by lastMinedBlock
 *    timestamp, dialing recently-mining peers first (proven active
 *    mesh participants with higher reconnection success).
 *
 * ── Virtuous Cycle ─────────────────────────────────────────────────────
 *
 *   mining → better connections → more peers reachable
 *   → more transactions to mine → more blocks
 *   → more connection data → stronger mesh
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Protocol Message Types ────────────────────────────────────────────

/** Enriched mining broadcast payload (extends existing blockchain-tx) */
export interface MiningMotionBroadcast {
  type: 'blockchain-tx';
  txId: string;
  actionType: 'mining_reward';
  from: string;
  minedAt: number;
  meta: {
    txCount: number;
    mbHosted: number;
    /** Number of active peer connections */
    peerCount: number;
    /** Up to 5 peer IDs for passive PEX discovery */
    librarySnapshot: string[];
    /** Seconds since node started */
    uptime: number;
    /** Cumulative blocks mined */
    blockHeight: number;
  };
}

/** Mining acknowledgement — sent in response to a blockchain-tx */
export interface MiningAck {
  type: 'mining-ack';
  from: string;
  /** Responder's cumulative blocks mined */
  blockHeight: number;
  /** Responder's active peer count */
  peerCount: number;
  /** Echoed minedAt from the original broadcast for RTT calc */
  echoMinedAt: number;
  ts: number;
}

// ── Constants (mirrored from swarmMesh.standalone.ts) ──────────────────

/** Mining loop interval in ms */
export const MINING_INTERVAL = 15_000;
/** Standard stale threshold */
export const PEER_STALE_THRESHOLD = 30_000;
/** Extended stale threshold for actively mining peers */
export const PEER_STALE_THRESHOLD_MINING = 60_000;
/** 3 × MINING_INTERVAL — peer is "cold" if no blocks in this window */
export const MINING_COLD_THRESHOLD = 45_000;
/** Max peer IDs carried in each mining broadcast for passive PEX */
export const LIBRARY_SNAPSHOT_SIZE = 5;
