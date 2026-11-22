/**
 * Wallet network preference
 * ─────────────────────────
 * Remembers which network the wallet was last showing (SWARM, MintMe, a
 * deployed sub-chain or a cell chain) so /Wallet reopens where the member left it after
 * navigating away or reloading.
 *
 * Stored per user in localStorage. Every read and write is guarded: when
 * storage is unavailable the wallet simply falls back to SWARM.
 */

import type { AssetNetwork } from "@/components/wallet/NetworkActionDialogs";

function storageKey(userId: string | null | undefined): string {
  return `swarm-space:wallet-network:${userId || "anon"}`;
}

export function isAssetNetwork(value: unknown): value is AssetNetwork {
  return (
    value === "swarm" ||
    value === "mintme" ||
    (typeof value === "string" && value.startsWith("chain:") && value.length > "chain:".length) ||
    (typeof value === "string" && value.startsWith("cell:") && value.length > "cell:".length)
  );
}

/** The network this user last picked, or SWARM when none is stored. */
export function loadWalletNetwork(userId: string | null | undefined): AssetNetwork {
  try {
    const stored = window.localStorage.getItem(storageKey(userId));
    return isAssetNetwork(stored) ? stored : "swarm";
  } catch {
    return "swarm";
  }
}

export function rememberWalletNetwork(userId: string | null | undefined, network: AssetNetwork): void {
  try {
    window.localStorage.setItem(storageKey(userId), network);
  } catch {
    /* storage unavailable: keep the in-memory choice only */
  }
}

/** Clears the remembered network (e.g. a retired sub-chain), so the wallet falls back to SWARM. */
export function forgetWalletNetwork(userId: string | null | undefined): void {
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}
