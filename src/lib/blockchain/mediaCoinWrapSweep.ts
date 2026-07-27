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
import {
  engraveFileOntoCoin,
  listAwaitingFiles,
} from "./syncVault";

let started = false;

async function freeMinedWalletCoins(): Promise<SwarmCoin[]> {
  try {
    const all = await getAll<SwarmCoin>("swarmCoins");
    // A mined SWARM coin holds wrapped SWARM tokens — that's expected.
    // Any wallet-held, non-media, non-spent coin can be engraved into a
    // Media Coin. Empty (unwrapped) coins are preferred so we don't
    // convert active SWARM balance first.
    const usable = all.filter(
      (c) =>
        c.status === "wallet" &&
        c.kind !== "media" &&
        c.fillState !== "spent",
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

  const free = await freeMinedWalletCoins();
  if (free.length === 0) return { engraved: 0, waiting: awaiting.length, wrapped: 0 };

  let engraved = 0;
  for (const { peerId, file } of awaiting) {
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

  return { engraved, waiting: awaiting.length - engraved, wrapped: engraved };
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