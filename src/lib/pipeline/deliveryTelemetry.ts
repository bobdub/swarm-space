/**
 * Delivery Telemetry — minimal pub/sub for content-delivery health signals.
 *
 * Sources emit events when content can't reach users:
 *   - pending manifests (loadBlogHeroImage, FilePreview, PostCard)
 *   - chunk-fetch failures (chunkProtocol)
 *   - decrypt retries / errors (streamingDecryptor, FilePreview)
 *
 * The UQRC healthBridge subscribes and converts these into field
 * curvature pressure via fieldEngine.inject(). No protocol changes,
 * no broadcasted state — purely local signal aggregation.
 */

export type DeliveryEventKind =
  | 'manifest-pending'
  | 'manifest-resolved'
  | 'chunk-failure'
  | 'decrypt-retry'
  | 'decrypt-failure';

export interface DeliveryEvent {
  kind: DeliveryEventKind;
  manifestId?: string;
  chunkRef?: string;
  at: number;
}

export interface DeliverySnapshot {
  pendingManifestIds: Set<string>;
  chunkFailures: number;       // rolling count over window
  decryptRetries: number;      // rolling count over window
  decryptFailures: number;     // rolling count over window
  windowMs: number;
  updatedAt: number;
}

const WINDOW_MS = 30_000;

const pending = new Set<string>();
const failures: Array<{ kind: DeliveryEventKind; at: number }> = [];
const listeners = new Set<(s: DeliverySnapshot) => void>();

function prune(now: number): void {
  const cutoff = now - WINDOW_MS;
  while (failures.length > 0 && failures[0].at < cutoff) failures.shift();
}

function snapshot(): DeliverySnapshot {
  const now = Date.now();
  prune(now);
  let chunkFailures = 0;
  let decryptRetries = 0;
  let decryptFailures = 0;
  for (const f of failures) {
    if (f.kind === 'chunk-failure') chunkFailures++;
    else if (f.kind === 'decrypt-retry') decryptRetries++;
    else if (f.kind === 'decrypt-failure') decryptFailures++;
  }
  return {
    pendingManifestIds: new Set(pending),
    chunkFailures,
    decryptRetries,
    decryptFailures,
    windowMs: WINDOW_MS,
    updatedAt: now,
  };
}

function notify(): void {
  if (listeners.size === 0) return;
  const snap = snapshot();
  for (const fn of listeners) {
    try { fn(snap); } catch { /* ignore */ }
  }
}

export function reportDeliveryEvent(event: Omit<DeliveryEvent, 'at'>): void {
  const now = Date.now();
  if (event.kind === 'manifest-pending' && event.manifestId) {
    pending.add(event.manifestId);
  } else if (event.kind === 'manifest-resolved' && event.manifestId) {
    pending.delete(event.manifestId);
  } else {
    failures.push({ kind: event.kind, at: now });
    if (failures.length > 500) failures.splice(0, failures.length - 500);
  }
  notify();
}

export function reportPendingManifests(ids: string[] | Iterable<string>): void {
  for (const id of ids) pending.add(id);
  notify();
}

export function getDeliverySnapshot(): DeliverySnapshot {
  return snapshot();
}

export function subscribeDelivery(fn: (s: DeliverySnapshot) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test helper. */
export function __resetDeliveryTelemetryForTests(): void {
  pending.clear();
  failures.length = 0;
  listeners.clear();
}
