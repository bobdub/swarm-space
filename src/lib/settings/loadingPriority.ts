/**
 * Loading priority — user-selected boot ordering preference.
 *
 * Persisted in localStorage under `swarm-loading-priority`. Read once at module
 * load in `main.tsx` and consulted by `useP2P` + `getCanonicalHome`.
 *
 * Modes:
 *  - gaming: Brain/virtual world first, p2p + social lazy. Default.
 *  - social: Local synced/cached content first, p2p defers, lands on /explore.
 *  - p2p:    Mesh/swarm connection first, world/NPC bootstraps defer.
 */

export type LoadingPriority = 'gaming' | 'social' | 'p2p';

export const LOADING_PRIORITY_STORAGE_KEY = 'swarm-loading-priority';
export const DEFAULT_LOADING_PRIORITY: LoadingPriority = 'gaming';

const VALID: readonly LoadingPriority[] = ['gaming', 'social', 'p2p'];

export function getLoadingPriority(): LoadingPriority {
  if (typeof window === 'undefined') return DEFAULT_LOADING_PRIORITY;
  try {
    const raw = window.localStorage.getItem(LOADING_PRIORITY_STORAGE_KEY);
    if (raw && (VALID as readonly string[]).includes(raw)) {
      return raw as LoadingPriority;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_LOADING_PRIORITY;
}

export function setLoadingPriority(priority: LoadingPriority): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOADING_PRIORITY_STORAGE_KEY, priority);
  } catch {
    /* ignore */
  }
}

/** Preferred landing route for logged-in users based on their priority. */
export function preferredMemberHome(priority: LoadingPriority = getLoadingPriority()): string {
  return priority === 'social' ? '/explore' : '/brain';
}

export const LOADING_PRIORITY_OPTIONS: {
  value: LoadingPriority;
  label: string;
  description: string;
}[] = [
  {
    value: 'gaming',
    label: 'Gaming',
    description:
      'Prioritize Brain virtual environment and actions first while connecting the P2P swarm. Social and media lazy-load. Lands on the main lobby Brain. (Default)',
  },
  {
    value: 'social',
    label: 'Social',
    description:
      'Prioritize local synced content and Explore first. P2P connects in the background; Brain lazy-loads. Lands on Explore.',
  },
  {
    value: 'p2p',
    label: 'P2P / Swarm',
    description:
      'Prioritize connecting to the P2P swarm first, then sync local data and new content. Recommended for users with linked personal servers. Lands on the main lobby Brain.',
  },
];