/**
 * mediaCoinWrapSweep — the vault engraver.
 *
 * Files never fabricate coins. Awaiting-engraver files sit in each
 * vault's `files[]` list until a free mined wallet coin is available
 * in the user's wallet. When one is, we engrave the file's metadata
 * onto that real coin (`kind = "media"`), then route the sealed coin
 * ref into the correct peer vault. This is the single writer.
 *
 * Backwards-compat: the exported names `runWrapSweep` / `startWrapSweep`
 * are preserved so existing boot / reconnect callers keep working.
 */
import { getAll, put } from "@/lib/store";
import type { SwarmCoin } from "./types";
import { COIN_MAX_WEIGHT } from "./types";
import {
  engraveFileOntoCoin,
  listAwaitingFiles,
} from "./syncVault";

let started = false;
let followUpTimer: ReturnType<typeof setTimeout> | null = null;

const ENGRAVE_BATCH_SIZE = 24;

function isMineBackedTransaction(tx: { type?: string; meta?: Record<string, unknown> }): boolean {
  if (tx.type === "mining_reward") return true;
  if (tx.type !== "token_mint") return false;
  const reason = String(tx.meta?.reason ?? "").toLowerCase();
  return reason.includes("confirmed mesh work") || reason.includes("network service unit");
}

function minedCoinId(userId: string, index: number): string {
  return `mined:${userId}:${index}`;
}

function buildMinedWalletCoin(params: {
  coinId: string;
  ownerId: string;
  minedAt: string;
  minedInBlock?: number;
}): SwarmCoin {
  return {
    coinId: params.coinId,
    weight: 0,
    maxWeight: COIN_MAX_WEIGHT,
    wrappedTokens: [],
    ownerId: params.ownerId,
    status: "wallet",
    minedAt: params.minedAt,
    minedInBlock: params.minedInBlock,
  };
}

async function hydrateMissingMinedWalletCoins(limit: number): Promise<number> {
  if (limit <= 0 || typeof window === "undefined") return 0;
  try {
    const [{ getCurrentUser }, { getSwarmChain }] = await Promise.all([
      import("@/lib/auth"),
      import("./chain"),
    ]);
    const user = getCurrentUser();
    if (!user) return 0;

    const existing = await getAll<SwarmCoin>("swarmCoins");
    const existingIds = new Set(existing.map((coin) => coin.coinId));
    const chain = getSwarmChain();
    await chain.whenReady();

    const records: SwarmCoin[] = [];
    const pending = chain.getPendingTransactions().map((tx) => ({ tx, height: undefined as number | undefined }));
    const mined = chain.getChain().flatMap((block) =>
      (block.transactions ?? []).map((tx) => ({ tx, height: block.index })),
    );
    const ledger = [...mined, ...pending].filter(({ tx }) => tx.to === user.id && isMineBackedTransaction(tx));
    const minedBalance = Math.floor(
      ledger.reduce((sum, { tx }) => {
        const amount = Number(tx.amount ?? 0);
        return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
      }, 0),
    );
    if (minedBalance <= 0) return 0;

    const representedWalletCoins = existing.filter((coin) => coin.ownerId === user.id && coin.status === "wallet").length;
    const missing = Math.max(0, minedBalance - representedWalletCoins);
    if (missing <= 0) return 0;

    const latestProof = ledger[ledger.length - 1];
    for (let i = representedWalletCoins; records.length < Math.min(limit, missing); i += 1) {
      const coinId = minedCoinId(user.id, i);
      if (existingIds.has(coinId)) continue;
      existingIds.add(coinId);
      records.push(buildMinedWalletCoin({
        coinId,
        ownerId: user.id,
        minedAt: latestProof?.tx.timestamp ?? new Date().toISOString(),
        minedInBlock: latestProof?.height,
      }));
    }

    for (const coin of records) await put("swarmCoins", coin);
    return records.length;
  } catch {
    return 0;
  }
}

async function freeMinedWalletCoins(): Promise<SwarmCoin[]> {
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const user = getCurrentUser();
    if (!user) return [];
    const all = await getAll<SwarmCoin>("swarmCoins");
    // Only truly free mined wallet coins may be engraved. Coins already
    // carrying wrapped tokens, chemicals, first artifacts, media payloads,
    // or spent state are not free containers.
    const usable = all.filter(
      (c) =>
        c.ownerId === user.id &&
        c.status === "wallet" &&
        c.kind !== "media" &&
        c.fillState !== "spent" &&
        (c.wrappedTokens?.length ?? 0) === 0 &&
        (c.wrappedChemicals?.length ?? 0) === 0 &&
        !c.firstArtifactNftId &&
        (c.weight ?? 0) <= 0,
    );
    usable.sort((a, b) => (a.wrappedTokens?.length ?? 0) - (b.wrappedTokens?.length ?? 0));
    return usable;
  } catch {
    return [];
  }
}

/**
 * Engrave as many awaiting files as free mined wallet coins allow.
 * Never allocates coins. Never seals unmet files. Returns counts so
 * callers can surface progress.
 */
export async function runWrapSweep(): Promise<{ engraved: number; waiting: number; wrapped: number }> {
  const awaiting = await listAwaitingFiles();
  if (awaiting.length === 0) return { engraved: 0, waiting: 0, wrapped: 0 };

  let free = await freeMinedWalletCoins();
  if (free.length === 0) {
    await hydrateMissingMinedWalletCoins(Math.min(awaiting.length, ENGRAVE_BATCH_SIZE));
    free = await freeMinedWalletCoins();
  }
  if (free.length === 0) return { engraved: 0, waiting: awaiting.length, wrapped: 0 };

  let engraved = 0;
  for (const { peerId, file } of awaiting.slice(0, ENGRAVE_BATCH_SIZE)) {
    const coin = free.shift();
    if (!coin) break;

    const ok = await engraveFileOntoCoin(peerId, {
      contentHash: file.contentHash,
      walletCoinId: coin.coinId,
      size: file.size,
      mime: file.mime,
      name: file.name,
      ref: file.ref,
      reason: "engraved",
    }).catch(() => false);

    if (!ok) {
      // Push the coin back — engraving may have been a no-op because
      // the file was already indexed elsewhere. Try it on the next file.
      free.unshift(coin);
      continue;
    }

    // Mark the wallet coin as a media container so wallet UI and
    // markets exclude it from the fungible pool.
    coin.kind = "media";
    coin.sealBytes = Math.max(coin.sealBytes ?? 0, file.size);
    coin.mediaTargets = [
      ...(coin.mediaTargets ?? []),
      { peerId, contentHashes: [file.contentHash] },
    ];
    coin.mediaRole = coin.mediaRole ?? "primary";
    try { await put("swarmCoins", coin); } catch { /* best-effort */ }

    engraved += 1;
  }

  const waiting = awaiting.length - engraved;
  if (engraved > 0 && waiting > 0 && typeof window !== "undefined" && !followUpTimer) {
    followUpTimer = setTimeout(() => {
      followUpTimer = null;
      void runWrapSweep().catch(() => {});
    }, 2_000);
  }

  return { engraved, waiting, wrapped: engraved };
}

export function startWrapSweep(): void {
  if (started) return;
  started = true;
  const tick = () => { void runWrapSweep().catch(() => {}); };
  tick();
  setInterval(tick, 60_000);
  if (typeof window !== "undefined") {
    // Freshly-mined coins are the primary unblocking event.
    window.addEventListener("blockchain-transaction", tick);
    window.addEventListener("swarm-coin-minted", tick);
  }
}