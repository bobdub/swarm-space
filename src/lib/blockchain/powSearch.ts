/**
 * Proof-of-work nonce search over a block's hashed text, `head + nonce + tail`
 * (see `calculateHash`). Shared by the mining worker and the main-thread
 * fallback, so both find exactly the nonce a one-by-one search would.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i]];
  return out;
}

/** True when the hex form of `bytes` starts with `zeros` "0" digits. */
export function hasLeadingHexZeros(bytes: Uint8Array, zeros: number): boolean {
  const full = Math.floor(zeros / 2);
  if (bytes.length * 2 < zeros) return false;
  for (let i = 0; i < full; i++) if (bytes[i] !== 0) return false;
  return zeros % 2 === 0 || (bytes[full] >> 4) === 0;
}

export interface PowJob {
  head: string;
  tail: string;
  start: number;
  difficulty: number;
}

export interface PowResult {
  nonce: number;
  hash: string;
}

/** Hashes per batch. */
const BATCH = 64;

/**
 * Try nonces upward from `job.start` and return the first whose SHA-256 has
 * `job.difficulty` leading hex zeros. `pause`, when given, runs between
 * batches (the main-thread fallback uses it to give frames room).
 */
export async function searchNonce(
  subtle: SubtleCrypto,
  job: PowJob,
  pause?: () => Promise<void> | void,
): Promise<PowResult> {
  const encoder = new TextEncoder();
  let nonce = job.start;
  for (;;) {
    const digests = await Promise.all(
      Array.from({ length: BATCH }, (_, i) =>
        subtle.digest("SHA-256", encoder.encode(job.head + (nonce + i).toString() + job.tail))),
    );
    for (let i = 0; i < digests.length; i++) {
      const bytes = new Uint8Array(digests[i]);
      if (hasLeadingHexZeros(bytes, job.difficulty)) return { nonce: nonce + i, hash: toHex(bytes) };
    }
    nonce += BATCH;
    if (pause) await pause();
  }
}
