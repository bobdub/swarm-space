/**
 * Deterministic map between a Swarm user id (the primary address inside the
 * mesh) and a 20-byte EVM-shaped address MetaMask can display.
 *
 * We use SHA-256 (available in every browser via SubtleCrypto) and take the
 * last 20 bytes. This is not keccak — we don't need Ethereum address
 * compatibility, we need a stable one-to-one mapping so the same identity
 * shows up on both sides of the doorway.
 */

const cache = new Map<string, string>();

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return new Uint8Array(buf);
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** Swarm user id → 0x-prefixed 20-byte address. */
export async function swarmIdToEvmAddress(swarmId: string): Promise<string> {
  const cached = cache.get(swarmId);
  if (cached) return cached;
  const digest = await sha256Bytes(`swarm-evm:${swarmId}`);
  const last20 = digest.slice(digest.length - 20);
  const addr = "0x" + toHex(last20);
  cache.set(swarmId, addr);
  return addr;
}

/** Sync variant that returns null if the mapping hasn't been computed yet. */
export function peekEvmAddress(swarmId: string): string | null {
  return cache.get(swarmId) ?? null;
}

/**
 * SWARM balances are integers in whole SWARM units inside the ledger; the
 * public EVM face is 18 decimals. This converts a whole-SWARM balance to a
 * 0x-prefixed wei quantity (as an EIP-1474 hex string).
 */
export function swarmToWeiHex(balanceWholeSwarm: number): string {
  if (!Number.isFinite(balanceWholeSwarm) || balanceWholeSwarm <= 0) return "0x0";
  const wei = BigInt(Math.floor(balanceWholeSwarm)) * 10n ** 18n;
  return "0x" + wei.toString(16);
}