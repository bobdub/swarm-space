// Creator Token market replication across the live SWARM mesh.
//
// Markets (profileTokens / creatorVaults / profileTokenHoldings) are local
// IndexedDB stores. Without replication only the owner can see their market.
// This module builds a compact snapshot, merges incoming snapshots with an
// "own record wins" rule, and can rebuild markets straight from chain history.
import { getAll, put } from "../store";
import type { CreatorToken, CreatorVault, SwarmTransaction } from "./types";
import {
  CREATOR_TOKEN_MAX_SUPPLY,
  CREATOR_TOKEN_INITIAL_UNLOCK_FRACTION,
} from "./types";
import type { ProfileTokenHolding } from "./profileTokenBalance";

const TOKEN_STORE = "profileTokens";
const VAULT_STORE = "creatorVaults";
const HOLDING_STORE = "profileTokenHoldings";

/** Data URLs above this size are stripped from sync payloads. */
const MAX_INLINE_IMAGE_CHARS = 24_000;

export interface MarketSnapshot {
  tokens: CreatorToken[];
  vaults: CreatorVault[];
  holdings: ProfileTokenHolding[];
}

function slimToken(token: CreatorToken): CreatorToken {
  const next: CreatorToken = { ...token };
  if (next.image && next.image.length > MAX_INLINE_IMAGE_CHARS) delete next.image;
  if (next.banner && next.banner.length > MAX_INLINE_IMAGE_CHARS) delete next.banner;
  return next;
}

/** Build a mesh-friendly snapshot of every market this node knows about. */
export async function buildMarketSnapshot(tokenId?: string): Promise<MarketSnapshot> {
  const [tokens, vaults, holdings] = await Promise.all([
    getAll<CreatorToken>(TOKEN_STORE).catch(() => [] as CreatorToken[]),
    getAll<CreatorVault>(VAULT_STORE).catch(() => [] as CreatorVault[]),
    getAll<ProfileTokenHolding>(HOLDING_STORE).catch(() => [] as ProfileTokenHolding[]),
  ]);

  const filterId = tokenId ?? null;
  return {
    tokens: tokens
      .filter((t) => !!t?.tokenId && (!filterId || t.tokenId === filterId))
      .map(slimToken),
    vaults: vaults.filter((v) => !!v?.tokenId && (!filterId || v.tokenId === filterId)),
    holdings: holdings.filter(
      (h) => !!h?.tokenId && !!h?.userId && (!filterId || h.tokenId === filterId),
    ),
  };
}

function isNewer(a?: string, b?: string): boolean {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta)) return false;
  if (Number.isNaN(tb)) return true;
  return ta > tb;
}

/**
 * Merge a peer snapshot into local stores.
 * Records owned by `localUserId` are never overwritten.
 */
export async function mergeMarketSnapshot(
  snapshot: MarketSnapshot | null | undefined,
  localUserId?: string | null,
): Promise<{ tokens: number; vaults: number; holdings: number }> {
  if (!snapshot) return { tokens: 0, vaults: 0, holdings: 0 };

  const [localTokens, localVaults, localHoldings] = await Promise.all([
    getAll<CreatorToken>(TOKEN_STORE).catch(() => [] as CreatorToken[]),
    getAll<CreatorVault>(VAULT_STORE).catch(() => [] as CreatorVault[]),
    getAll<ProfileTokenHolding>(HOLDING_STORE).catch(() => [] as ProfileTokenHolding[]),
  ]);

  const tokenByUser = new Map(localTokens.map((t) => [t.userId, t]));
  const vaultById = new Map(localVaults.map((v) => [v.tokenId, v]));
  const holdingByKey = new Map(localHoldings.map((h) => [`${h.userId}:${h.tokenId}`, h]));

  let tokens = 0;
  let vaults = 0;
  let holdings = 0;

  for (const incoming of snapshot.tokens ?? []) {
    if (!incoming?.userId || !incoming?.tokenId) continue;
    if (localUserId && incoming.userId === localUserId) continue; // own record wins
    const existing = tokenByUser.get(incoming.userId);
    if (existing) {
      // Keep locally-known artwork when the peer stripped it for transport.
      const merged: CreatorToken = {
        ...existing,
        ...incoming,
        image: incoming.image ?? existing.image,
        banner: incoming.banner ?? existing.banner,
      };
      const changed =
        isNewer(incoming.deployedAt, existing.deployedAt) ||
        merged.supply !== existing.supply ||
        merged.name !== existing.name ||
        merged.ticker !== existing.ticker ||
        merged.image !== existing.image ||
        merged.banner !== existing.banner ||
        merged.closedAt !== existing.closedAt;
      if (!changed) continue;
      await put(TOKEN_STORE, merged);
    } else {
      await put(TOKEN_STORE, incoming);
    }
    tokens++;
  }

  for (const incoming of snapshot.vaults ?? []) {
    if (!incoming?.tokenId) continue;
    if (localUserId && incoming.creatorUserId === localUserId) continue; // own record wins
    const existing = vaultById.get(incoming.tokenId);
    if (existing) {
      const better =
        incoming.totalDeposited > existing.totalDeposited ||
        (incoming.totalDeposited === existing.totalDeposited &&
          isNewer(incoming.updatedAt, existing.updatedAt));
      if (!better) continue;
    }
    // put() directly so the peer's updatedAt is preserved for future compares.
    await put(VAULT_STORE, incoming);
    vaults++;
  }

  for (const incoming of snapshot.holdings ?? []) {
    if (!incoming?.userId || !incoming?.tokenId) continue;
    if (localUserId && incoming.userId === localUserId) continue; // own balance wins
    const existing = holdingByKey.get(`${incoming.userId}:${incoming.tokenId}`);
    if (existing && !isNewer(incoming.lastUpdated, existing.lastUpdated)) continue;
    await put(HOLDING_STORE, incoming);
    holdings++;
  }

  if ((tokens || vaults || holdings) && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("creator-token-updated", { detail: { source: "mesh" } }));
    window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { source: "mesh" } }));
  }

  return { tokens, vaults, holdings };
}

/**
 * Fallback source of truth: rebuild missing market records from
 * `profile_token_deploy` transactions already present in the chain.
 */
export async function rebuildMarketsFromChain(): Promise<number> {
  const { getSwarmChain } = await import("./chain");
  const chain = getSwarmChain();

  const txs: SwarmTransaction[] = [];
  for (const block of chain.getChain()) {
    for (const tx of block.transactions ?? []) {
      if (tx?.type === "profile_token_deploy") txs.push(tx);
    }
  }
  for (const tx of chain.getPendingTransactions()) {
    if (tx?.type === "profile_token_deploy") txs.push(tx);
  }
  if (txs.length === 0) return 0;

  const [localTokens, localVaults] = await Promise.all([
    getAll<CreatorToken>(TOKEN_STORE).catch(() => [] as CreatorToken[]),
    getAll<CreatorVault>(VAULT_STORE).catch(() => [] as CreatorVault[]),
  ]);
  const tokenByUser = new Map(localTokens.map((t) => [t.userId, t]));
  const vaultById = new Map(localVaults.map((v) => [v.tokenId, v]));

  let rebuilt = 0;
  for (const tx of txs) {
    const userId = tx.from;
    const tokenId = tx.tokenId;
    if (!userId || !tokenId) continue;
    if (tokenByUser.has(userId)) continue;

    const meta = (tx.meta ?? {}) as Record<string, unknown>;
    const ticker = typeof meta.ticker === "string" ? meta.ticker : null;
    if (!ticker) continue;
    const name = typeof meta.tokenName === "string" ? meta.tokenName : ticker;
    const maxSupply =
      typeof meta.maxSupply === "number" ? meta.maxSupply : CREATOR_TOKEN_MAX_SUPPLY;
    const supply =
      typeof meta.initialSupply === "number"
        ? meta.initialSupply
        : Math.floor(maxSupply * CREATOR_TOKEN_INITIAL_UNLOCK_FRACTION);

    const token: CreatorToken = {
      tokenId,
      userId,
      name,
      ticker,
      supply,
      maxSupply,
      deployedAt: tx.timestamp ?? new Date().toISOString(),
      contractAddress: `swarm://${tokenId}`,
    };
    await put(TOKEN_STORE, token);
    tokenByUser.set(userId, token);

    if (!vaultById.has(tokenId)) {
      const seed = typeof meta.seedSwarm === "number" ? meta.seedSwarm : 0;
      const {
        CREATOR_VAULT_BUYBACK_SHARE,
        CREATOR_VAULT_STABILITY_SHARE,
        CREATOR_VAULT_CREATOR_SHARE,
      } = await import("./types");
      const vault: CreatorVault = {
        tokenId,
        creatorUserId: userId,
        buybackReserve: seed * CREATOR_VAULT_BUYBACK_SHARE,
        stabilityFloor: seed * CREATOR_VAULT_STABILITY_SHARE,
        creatorEarnings: seed * CREATOR_VAULT_CREATOR_SHARE,
        communityContributed: 0,
        totalDeposited: seed,
        lifetimeBuybacks: 0,
        circulatingSupply: typeof tx.amount === "number" ? tx.amount : 0,
        currentTier: 0,
        updatedAt: tx.timestamp ?? new Date().toISOString(),
      };
      await put(VAULT_STORE, vault);
      vaultById.set(tokenId, vault);
    }
    rebuilt++;
  }

  if (rebuilt > 0) {
    console.log(`[MarketSync] 🏪 Rebuilt ${rebuilt} market(s) from chain history`);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("creator-token-updated", { detail: { source: "chain" } }));
      window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { source: "chain" } }));
    }
  }
  return rebuilt;
}