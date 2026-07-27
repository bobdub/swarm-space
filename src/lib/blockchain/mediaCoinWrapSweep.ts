/**
 * mediaCoinWrapSweep — periodically tries to wrap sealed media coins
 * with a free wallet coin once the user has enough SWARM. Respects a
 * 24 h retry cooldown per coin.
 */
import { getAll } from "@/lib/store";
import type { SwarmCoin } from "./types";
import { MEDIA_COIN_CAPACITY_BYTES, MEDIA_COIN_WRAP_FEE, MEDIA_COIN_WRAP_RETRY_MS } from "./types";
import {
  attemptWrapMediaCoin,
  listSealedMediaCoins,
  markWrapAttempt,
} from "./syncVault";

let started = false;

async function freeWalletCoins(): Promise<SwarmCoin[]> {
  try {
    const all = await getAll<SwarmCoin>("swarmCoins");
    return all.filter(
      (c) =>
        c.status === "wallet" &&
        c.kind !== "media" &&
        c.fillState !== "spent" &&
        (c.wrappedTokens?.length ?? 0) === 0,
    );
  } catch {
    return [];
  }
}

async function currentSwarmBalance(): Promise<number> {
  // Best-effort: count free wallet coins as SWARM units. The wrap fee
  // is 1, so having ≥1 free coin means we can pay and use one as the
  // container.
  return (await freeWalletCoins()).length;
}

export async function runWrapSweep(): Promise<{ wrapped: number; waiting: number }> {
  const sealed = await listSealedMediaCoins();
  if (sealed.length === 0) return { wrapped: 0, waiting: 0 };

  const balance = await currentSwarmBalance();
  if (balance < MEDIA_COIN_WRAP_FEE) return { wrapped: 0, waiting: sealed.length };

  const free = await freeWalletCoins();
  const now = Date.now();
  let wrapped = 0;
  let waiting = 0;

  for (const { peerId, ref } of sealed) {
    const last = ref.lastWrapAttemptAt ? new Date(ref.lastWrapAttemptAt).getTime() : 0;
    if (last && now - last < MEDIA_COIN_WRAP_RETRY_MS) { waiting += 1; continue; }
    const coin = free.shift();
    if (!coin) {
      await markWrapAttempt(peerId, ref.coinId).catch(() => {});
      waiting += 1;
      continue;
    }
    const needsAssist = ref.fillBytes > MEDIA_COIN_CAPACITY_BYTES || ref.capacityBytes > MEDIA_COIN_CAPACITY_BYTES;
    const assistCoin = needsAssist ? free.shift() : undefined;
    const ok = await attemptWrapMediaCoin(peerId, ref.coinId, coin, assistCoin).catch(() => false);
    if (ok) wrapped += 1; else waiting += 1;
  }
  return { wrapped, waiting };
}

export function startWrapSweep(): void {
  if (started) return;
  started = true;
  const tick = () => { void runWrapSweep().catch(() => {}); };
  tick();
  setInterval(tick, 5 * 60_000);
  if (typeof window !== "undefined") {
    window.addEventListener("blockchain-transaction", tick);
  }
}