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
export const SELF_MINT_CUTOFF_MS = Date.parse("2026-11-22T00:00:00Z");
/** A block reward can be spent once this many blocks sit on top of it (about one epoch at 30 s). */
export const REWARD_MATURITY_BLOCKS = 20;
/** A hollow block (no content served) pays this share of the height's reward. */
export const HOLLOW_REWARD_SHARE = 0.5;

/** Share of every block reward paid to the community pool (the old 5% mining tax). */
export const POOL_REWARD_SHARE = 0.05;
export const COMMUNITY_POOL = "community-pool";

/** Types that credit `to` with SWARM: from "system", any of these creates coins. */
const SELF_ISSUE_TYPES = new Set([
  "token_mint", "pool_donate", "token_transfer", "wallet_tip", "credit_lock", "coin_transfer",
  "coin_deploy", "creator_token_deploy", "profile_token_deploy", "cross_chain_swap",
  "coin_market_list", "coin_market_settle", "coin_market_cancel",
]);

/** SWARM a device issued to itself from "system" (outside the block reward): unverifiable by anyone else. */
export function isSelfIssuedSwarmMint(tx: Pick<SwarmTransaction, "type" | "from" | "tokenId"> | null | undefined): boolean {
  return !!tx && tx.from === "system" && !tx.tokenId && SELF_ISSUE_TYPES.has(tx.type);
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

/**
 * Hard fork: SWARM rewards issued on a member's own device before rewards
 * moved into blocks join the shared chain through one signed claim per
 * member. The claim is signed by the member's identity key, credits only that
 * member, may appear once per member on the chain, is capped, and is accepted
 * only in blocks stamped before the deadline.
 */
export const LEGACY_REWARD_CLAIM = "legacy_reward_claim";
export const LEGACY_CLAIM_DEADLINE_MS = Date.parse("2027-01-01T00:00:00Z");
/** The most SWARM one member's claim may carry. */
export const LEGACY_CLAIM_MAX = 100_000;

export function isLegacyRewardClaim(tx: Pick<SwarmTransaction, "type"> | null | undefined): boolean {
  return !!tx && tx.type === LEGACY_REWARD_CLAIM;
}

/** True when a block is stamped too late to carry a legacy reward claim. */
export function blockForbidsLegacyClaims(block: Pick<SwarmBlock, "timestamp">, deadlineMs = LEGACY_CLAIM_DEADLINE_MS): boolean {
  const stamped = Date.parse(block.timestamp);
  return !Number.isFinite(stamped) || stamped >= deadlineMs;
}

/**
 * Hard fork: from this instant on, a block may carry a SWARM spend (a vault
 * donation or a SWARM transfer, as bar drinks, Support the Vault and the
 * Trading Stand write) only when the spender holds the amount on the ledger
 * up to that point in the block. A member's spend must also carry the
 * member's signature. Without this, one account could spend the same SWARM
 * from two devices: each device mines its own copy, and the second credits
 * the receiver with SWARM that no longer exists.
 */
export const SPEND_CHECK_CUTOFF_MS = Date.parse("2026-12-04T00:00:00Z");

/** True when a block is stamped late enough that its SWARM spends are balance- and signature-checked. */
export function blockChecksSpends(block: Pick<SwarmBlock, "timestamp">, cutoffMs = SPEND_CHECK_CUTOFF_MS): boolean {
  const stamped = Date.parse(block.timestamp);
  return !Number.isFinite(stamped) || stamped >= cutoffMs;
}

/** A member's identity address (the first 16 hex characters of their key's hash), as opposed to a vault or escrow. */
export function isMemberAddress(address: unknown): address is string {
  return typeof address === "string" && /^[a-f0-9]{16}$/.test(address);
}

/** A SWARM spend (the ledger counts both types as SWARM) from someone other than "system": checked against the spender's balance once spends are checked. */
export function isCheckedSwarmSpend(tx: Pick<SwarmTransaction, "type" | "from"> | null | undefined): boolean {
  return !!tx && !!tx.from && tx.from !== "system" && (tx.type === "pool_donate" || tx.type === "token_transfer");
}
