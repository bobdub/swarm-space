/**
 * Manual connection coordinator.
 *
 * A user pressing "Connect" (wifi icon quick-connect, a discovered peer in the
 * popover, or a Node/Peer ID typed into the Node Dashboard) gets the same
 * a short, honest window: the node is enabled if it is off, the dial is sent
 * once and retried once 11 s later (the retry follows the normal no-stacking
 * rule, so an in-flight dial is never doubled), and the open DataChannel, or a
 * relay route for a stalled same-Wi-Fi dial, is detected by polling each
 * second. With no answer the request fails at about 22 s.
 *
 * The module is pure state + a `tick` the app-wide runner calls once a
 * second, so it keeps working after the popover or dashboard closes.
 */

export type ManualConnectPhase = 'idle' | 'starting' | 'connecting' | 'syncing' | 'connected' | 'unavailable';

export type ManualConnectEntry = {
  /** Dial target (always a `peer-…` id). */
  peerId: string;
  /** Short name for toasts and buttons. */
  label: string;
  source: string;
  phase: ManualConnectPhase;
  startedAt: number;
  /** When the DataChannel first opened; null until then. */
  connectedAt: number | null;
  attempts: number;
  lastAttemptAt: number;
  /** First time the local node refused to dial (still warming up); 0 when not refusing. */
  firstRefusedAt: number;
  /** When this request switched networking on; null if it never had to. */
  enableRequestedAt: number | null;
  /** Networking has been seen on while this request was pending. */
  sawEnabled: boolean;
  /** Optional dial override (e.g. Builder cell dashboard); defaults to the P2P context dial. */
  dial?: (peerId: string) => boolean;
};

/** Fail toast after 20-25 s with one retry: dial at 0 s, retry at 11 s, give up at 22 s. */
export const MANUAL_REDIAL_INTERVAL_MS = 11_000;
export const MANUAL_MAX_ATTEMPTS = 2;
/** Without a peer name, the open channel counts as connected after this long. */
export const MANUAL_SYNC_GRACE_MS = 12_000;
/** Time for `enable()` to show up as "connecting" before an off network means the user turned it off. */
const ENABLE_SETTLE_MS = 5_000;
/**
 * How long the local node may keep refusing to dial (signaling and keys still
 * warming up) before the request is unavailable. Independent of the short dial
 * window, so a slow cold start never cuts a manual connect short.
 */
export const MANUAL_REFUSED_GRACE_MS = 160_000;

const ACTIVE_PHASES: ReadonlySet<ManualConnectPhase> = new Set(['starting', 'connecting', 'syncing']);

let entries: ReadonlyMap<string, ManualConnectEntry> = new Map();
const listeners = new Set<() => void>();

function publish(next: Map<string, ManualConnectEntry>) {
  entries = next;
  listeners.forEach(listener => listener());
}

function update(peerId: string, patch: Partial<ManualConnectEntry>) {
  const current = entries.get(peerId);
  if (!current) return;
  const next = new Map(entries);
  next.set(peerId, { ...current, ...patch });
  publish(next);
}

export const getManualConnects = () => entries;
export const subscribeManualConnects = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function isManualConnectActive(entry: ManualConnectEntry | undefined): boolean {
  return Boolean(entry && ACTIVE_PHASES.has(entry.phase));
}

export function hasActiveManualConnects(): boolean {
  for (const entry of entries.values()) if (isManualConnectActive(entry)) return true;
  return false;
}

/** Normalizes a typed id to the `peer-…` dial target, or null when it is not an id. */
export function manualConnectTarget(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  return trimmed.startsWith('peer-') ? trimmed : `peer-${trimmed}`;
}

/**
 * Start (or restart) a persistent manual connect. Returns the dial target, or
 * null when the input is not a usable id. A request already in flight for the
 * same peer is left running rather than restarted.
 */
export function requestManualConnect(
  input: string,
  options: { label?: string; source?: string; dial?: (peerId: string) => boolean; now?: number } = {},
): string | null {
  const peerId = manualConnectTarget(input);
  if (!peerId) return null;
  const existing = entries.get(peerId);
  if (isManualConnectActive(existing)) return peerId;
  const next = new Map(entries);
  next.set(peerId, {
    peerId,
    label: options.label?.trim() || peerId.slice(0, 16),
    source: options.source ?? 'manual',
    phase: 'starting',
    startedAt: options.now ?? Date.now(),
    connectedAt: null,
    attempts: 0,
    lastAttemptAt: 0,
    firstRefusedAt: 0,
    enableRequestedAt: null,
    sawEnabled: false,
    dial: options.dial,
  });
  publish(next);
  return peerId;
}

export function cancelManualConnect(input: string) {
  const peerId = manualConnectTarget(input);
  if (!peerId || !entries.has(peerId)) return;
  const next = new Map(entries);
  next.delete(peerId);
  publish(next);
}

/** Drops finished entries (connected / unavailable) so they no longer show. */
export function clearSettledManualConnect(peerId: string) {
  const entry = entries.get(peerId);
  if (!entry || isManualConnectActive(entry)) return;
  const next = new Map(entries);
  next.delete(peerId);
  publish(next);
}

export type ManualConnectEnv = {
  now?: number;
  /** Whether networking is switched on (enabled or starting). */
  isEnabled: boolean;
  /** Whether the node is still bringing networking up. */
  isConnecting: boolean;
  /** Turns networking on; called at most while disabled and not already starting. */
  enable: () => void;
  selfId: string | null;
  isBlocked: (peerId: string) => boolean;
  /** Default dial; returns true when a dial was sent or queued. */
  dial: (peerId: string) => boolean;
  /** The peer's DataChannel is open (it is in the active connections). */
  isConnected: (peerId: string) => boolean;
  /** The peer's identity/presence has resolved over the open channel. */
  isNamed: (peerId: string) => boolean;
};

/** Advances every active manual connect by one step. Call about once a second. */
export function tickManualConnects(env: ManualConnectEnv) {
  const now = env.now ?? Date.now();
  for (const entry of [...entries.values()]) {
    if (!isManualConnectActive(entry)) continue;
    tickEntry(entry, env, now);
  }
}

function tickEntry(entry: ManualConnectEntry, env: ManualConnectEnv, now: number) {
  const { peerId } = entry;

  if (env.isEnabled && !entry.sawEnabled) {
    update(peerId, { sawEnabled: true });
    entry = entries.get(peerId)!;
  }

  if (env.isConnected(peerId)) {
    if (entry.phase !== 'syncing') {
      update(peerId, { phase: 'syncing', connectedAt: now, firstRefusedAt: 0 });
      entry = entries.get(peerId)!;
    }
    if (env.isNamed(peerId) || now - (entry.connectedAt ?? now) >= MANUAL_SYNC_GRACE_MS) {
      update(peerId, { phase: 'connected' });
    }
    return;
  }

  if (entry.phase === 'syncing') {
    // The channel closed before the peer was named: knock again from where we left off.
    update(peerId, { phase: 'connecting', connectedAt: null });
    entry = entries.get(peerId)!;
  }

  if (peerId === env.selfId || env.isBlocked(peerId)) {
    update(peerId, { phase: 'unavailable' });
    return;
  }

  if (!env.isEnabled) {
    if (!env.isConnecting) {
      const enableSettled = entry.enableRequestedAt !== null && now - entry.enableRequestedAt >= ENABLE_SETTLE_MS;
      if (entry.sawEnabled || enableSettled) {
        // Networking was on during this request (already on, or switched on
        // for it) and is off again: the user turned it off, or it failed.
        // Respect that instead of switching it back on.
        cancelManualConnect(peerId);
        return;
      }
      if (entry.enableRequestedAt === null) {
        // Bring networking up once and hold the dial until it is ready.
        update(peerId, { enableRequestedAt: now });
        try { env.enable(); } catch { /* reported by the node itself */ }
      }
    }
    holdRefused(entries.get(peerId)!, now);
    return;
  }

  const due = entry.attempts === 0 || now - entry.lastAttemptAt >= MANUAL_REDIAL_INTERVAL_MS;
  if (!due) return;

  if (entry.attempts >= MANUAL_MAX_ATTEMPTS) {
    // Every knock went unanswered and the last one had its full window to land.
    update(peerId, { phase: 'unavailable' });
    return;
  }

  let sent = false;
  try { sent = (entry.dial ?? env.dial)(peerId); } catch { sent = false; }
  if (sent) {
    update(peerId, { phase: 'connecting', attempts: entry.attempts + 1, lastAttemptAt: now, firstRefusedAt: 0 });
    return;
  }
  // A refused dial usually means signaling or keys are still warming up.
  // Keep the request buffered and ask again on the next tick.
  holdRefused(entry, now);
}

function holdRefused(entry: ManualConnectEntry, now: number) {
  const firstRefusedAt = entry.firstRefusedAt || now;
  if (now - firstRefusedAt >= MANUAL_REFUSED_GRACE_MS) {
    update(entry.peerId, { phase: 'unavailable' });
    return;
  }
  if (entry.firstRefusedAt !== firstRefusedAt) update(entry.peerId, { firstRefusedAt });
}

/** Test helper: forget every request. */
export function resetManualConnects() {
  publish(new Map());
}

/**
 * Whether an active connection's peer id answers a manual target. A typed
 * Node ID dials `peer-<nodeId>`, but the node's live Peer ID is
 * `peer-<first 12 hex of nodeId>-…`, so match on that prefix too.
 */
export function matchesManualTarget(target: string, connectedPeerId: string): boolean {
  if (connectedPeerId === target) return true;
  const nodeId = /^peer-([a-f0-9]{16})$/i.exec(target)?.[1];
  return Boolean(nodeId && connectedPeerId.toLowerCase().startsWith(`peer-${nodeId.slice(0, 12).toLowerCase()}-`));
}
