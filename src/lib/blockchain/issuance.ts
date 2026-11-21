/**
 * Coin issuance, Bitcoin-style: the only way new SWARM enters the shared
 * chain is the single `mining_reward` inside each block.
 *
 * Self-issued mints (`token_mint` from "system", no tokenId) are written by a
 * device for itself and nobody can check them, so peers never take them from
 * another device, and blocks stamped from the cutoff on may not carry them.
 */
import type { SwarmBlock, SwarmTransaction } from "./types";

/** Blocks stamped at or after this instant may not carry self-issued SWARM mints. */
export const SELF_MINT_CUTOFF_MS = Date.parse("2026-11-28T00:00:00Z");
/** A block reward can be spent once this many blocks sit on top of it (about one epoch at 30 s). */
export const REWARD_MATURITY_BLOCKS = 20;
/** A hollow block (no content served) pays this share of the height's reward. */
export const HOLLOW_REWARD_SHARE = 0.5;

/** A SWARM mint a device issued to itself: unverifiable by anyone else. */
export function isSelfIssuedSwarmMint(tx: Pick<SwarmTransaction, "type" | "from" | "tokenId"> | null | undefined): boolean {
  return !!tx && tx.type === "token_mint" && tx.from === "system" && !tx.tokenId;
}

/** True when a block is stamped late enough that it must not carry self-issued mints. */
export function blockForbidsSelfMints(block: Pick<SwarmBlock, "timestamp">, cutoffMs = SELF_MINT_CUTOFF_MS): boolean {
  const stamped = Date.parse(block.timestamp);
  return !Number.isFinite(stamped) || stamped >= cutoffMs;
}

/** Whether a reward in the block at `blockIndex` is spendable on a chain of `chainLength` blocks. */
export function isRewardMature(blockIndex: number, chainLength: number, maturity = REWARD_MATURITY_BLOCKS): boolean {
  return chainLength - 1 - blockIndex >= maturity;
}
