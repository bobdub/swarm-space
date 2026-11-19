/**
 * Gun.js relays shared by the Global Cell (auto-connect discovery, invite
 * knocks) and the MintMe mining cell.
 *
 * Auto-connect, invite knocks and the "dial back" half of a manual connect all
 * travel over Gun. If every listed relay is dead, those paths go silent while
 * saved-library reconnects (pure PeerJS) keep working. Keep at least one known
 * live relay first: `relay.peer.ooo` is the public relay run by the Gun
 * project. `gun.eco/gun` serves the docs site, not a relay, so it is a backup
 * at best.
 *
 * `VITE_GUN_RELAYS` (JSON array or comma-separated URLs) adds relays ahead of
 * the defaults.
 */
export const DEFAULT_GUN_RELAYS: readonly string[] = [
  'https://relay.peer.ooo/gun',
  'https://e2e.we-share.io/gun',
  'https://gun.eco/gun',
];

type EnvShape = Record<string, string | boolean | undefined>;

function parseRelayList(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  let items: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    items = raw.split(',');
  }
  return items
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => /^(https?|wss?):\/\/[^\s]+$/i.test(v));
}

/** Configured relays first, then the defaults, without duplicates. */
export function resolveGunRelays(env: EnvShape = {}): string[] {
  return [...new Set([...parseRelayList(env.VITE_GUN_RELAYS), ...DEFAULT_GUN_RELAYS])];
}

export const GUN_RELAYS: string[] = resolveGunRelays(
  (import.meta.env ?? {}) as EnvShape,
);
