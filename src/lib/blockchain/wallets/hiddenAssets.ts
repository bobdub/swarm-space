/**
 * Per-user hidden asset list for the Native wallet.
 *
 * Nothing is hidden automatically: the wallet shows every asset it knows
 * about, and the owner chooses to hide a token — but only while its balance
 * is zero, and never SWARM (the native coin is always displayed). Hidden
 * assets collapse into a "Hidden assets" section where they can be restored.
 */
export const HIDDEN_ASSETS_EVENT = "swarm-hidden-assets";

const KEY = (uid: string) => `swarm-hidden-assets:${uid`;

export function listHiddenAssets(uid: string): string[] {
  if (!uid) return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY(uid)) || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function isAssetHidden(uid: string, assetId: string): boolean {
  return listHiddenAssets(uid).includes(assetId);
}

/** SWARM is the native coin and is always displayed. */
export function canHideAsset(assetId: string, balance: number): boolean {
  return assetId !== "SWARM" && balance <= 0;
}

export function setAssetHidden(uid: string, assetId: string, hidden: boolean): void {
  if (!uid) return;
  if (assetId === "SWARM" && hidden) return;
  const current = listHiddenAssets(uid);
  const next = hidden ? [...new Set([...current, assetId])] : current.filter((id) => id !== assetId);
  try {
    localStorage.setItem(KEY(uid), JSON.stringify(next));
  } catch {
    /* quota */
  }
  // Durable mirror so the owner's choice survives localStorage wipes.
  void import("../../store")
    .then(({ put }) => put("meta", { k: KEY(uid), v: next }))
    .catch(() => {
      /* best effort */
    });
  try {
    window.dispatchEvent(new CustomEvent(HIDDEN_ASSETS_EVENT));
  } catch {
    /* non-browser */
  }
}

/** Restore hidden choices from the durable mirror, merging with localStorage. */
export async function hydrateHiddenAssets(uid: string): Promise<string[]> {
  if (!uid) return [];
  const local = listHiddenAssets(uid);
  try {
    const { get } = await import("../../store");
    const entry = await get<{ k: string; v: string[] }>("meta", KEY(uid));
    const durable = entry && Array.isArray(entry.v) ? entry.v.filter((x): x is string => typeof x === "string") : [];
    const merged = [...new Set([...durable, ...local])].filter((id) => id !== "SWARM");
    if (merged.length !== local.length) {
      try {
        localStorage.setItem(KEY(uid), JSON.stringify(merged));
      } catch {
        /* quota */
      }
    }
    return merged;
  } catch {
    return local;
  }
}
