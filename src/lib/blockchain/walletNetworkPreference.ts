/**
 * Wallet network preference
 * ─────────────────────────
 * Remembers which network the wallet was last showing (SWARM, MintMe or a
 * deployed sub-chain) and a short most-recent-first list of networks the
 * user has picked, so /Wallet reopens where they left it after navigating
 * away or reloading, and the network picker can put recent networks first.
 *
 * Stored per user in localStorage. Every read and write is guarded: when
 * storage is unavailable the wallet simply falls back to SWARM.
 */

import type { AssetNetwork } from "@/components/wallet/NetworkActionDialogs";

export const RECENT_NETWORK_LIMIT = 5;

export interface WalletNetworkPreference {
  selected: AssetNetwork;
  /** Most recently used first, no duplicates, at most RECENT_NETWORK_LIMIT. */
  recent: AssetNetwork[];
}

const DEFAULT_PREFERENCE: WalletNetworkPreference = { selected: "swarm", recent: [] };

function storageKey(userId: string | null | undefined): string {
  return `swarm-space:wallet-network:${userId || "anon"}`;
}

export function isAssetNetwork(value: unknown): value is AssetNetwork {
  return (
    value === "swarm" ||
    value === "mintme" ||
    (typeof value === "string" && value.startsWith("chain:") && value.length > "chain:".length)
  );
}

export function loadWalletNetworkPreference(userId: string | null | undefined): WalletNetworkPreference {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return { ...DEFAULT_PREFERENCE, recent: [] };
    const parsed = JSON.parse(raw) as Partial<WalletNetworkPreference>;
    const selected = isAssetNetwork(parsed.selected) ? parsed.selected : "swarm";
    const recent = Array.isArray(parsed.recent)
      ? parsed.recent.filter(isAssetNetwork).filter((n, i, all) => all.indexOf(n) === i).slice(0, RECENT_NETWORK_LIMIT)
      : [];
    return { selected, recent };
  } catch {
    return { ...DEFAULT_PREFERENCE, recent: [] };
  }
}

/** Puts `network` at the front of `recent`, dropping duplicates and overflow. */
export function pushRecentNetwork(recent: AssetNetwork[], network: AssetNetwork): AssetNetwork[] {
  return [network, ...recent.filter((n) => n !== network)].slice(0, RECENT_NETWORK_LIMIT);
}

/** Records `network` as selected and most recently used; returns the new preference. */
export function rememberWalletNetwork(
  userId: string | null | undefined,
  network: AssetNetwork,
): WalletNetworkPreference {
  const current = loadWalletNetworkPreference(userId);
  const next: WalletNetworkPreference = {
    selected: network,
    recent: pushRecentNetwork(current.recent, network),
  };
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* storage unavailable: keep the in-memory choice only */
  }
  return next;
}

/** Drops a network that no longer exists (e.g. a retired sub-chain). */
export function forgetWalletNetwork(
  userId: string | null | undefined,
  network: AssetNetwork,
): WalletNetworkPreference {
  const current = loadWalletNetworkPreference(userId);
  const next: WalletNetworkPreference = {
    selected: current.selected === network ? "swarm" : current.selected,
    recent: current.recent.filter((n) => n !== network),
  };
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** The picker value ChainSwitcher uses for a wallet network. */
export function networkToChainOption(network: AssetNetwork): string {
  if (network === "mintme") return "mintme";
  if (network === "swarm") return "SWARM";
  return network.slice("chain:".length);
}
