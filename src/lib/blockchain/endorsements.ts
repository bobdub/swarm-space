/**
 * Signed CREATOR endorsements: a peer that was online for a live block checks
 * it and signs its verdict with the identity key from its vault.
 *
 * - The signature covers network, block hash, height, epoch and round, plus
 *   the voter's identity, observation time and clock session.
 * - A peer agrees to at most one block per height. That choice is saved
 *   before the endorsement is sent, so even after a restart it won't back a
 *   rival block at the same height.
 * - Endorsements are kept beside the block as a certificate: who signed, who
 *   declined, each voter counted once.
 */
import { arrayBufferToBase64, base64ToArrayBuffer, computeUserId } from "@/lib/crypto";
import { CLOCK_SESSION } from "./blockHeader";
import type { SwarmBlock } from "./types";

export const ENDORSEMENT_NETWORK = "SWARM";

export interface Endorsement {
  network: string;
  blockHash: string;
  height: number;
  epoch: number;
  /** The round: the block's cadence tick. */
  round: number;
  agree: boolean;
  voter: string;
  publicKey: string;
  observedAt: number;
  clockSession: string;
  signature: string;
}

export interface EndorsementSigner {
  userId: string;
  publicKey: string;
  signText(text: string): Promise<string>;
}

function payload(e: Omit<Endorsement, "signature">): string {
  return JSON.stringify([
    e.network, e.blockHash, e.height, e.epoch, e.round, e.agree,
    e.voter, e.publicKey, e.observedAt, e.clockSession,
  ]);
}

/** Signer over arbitrary text, backed by the vault's identity key (PKCS#8, base64). */
export function endorsementSignerFromKeys(userId: string, publicKey: string, privateKey: string): EndorsementSigner {
  return {
    userId,
    publicKey,
    async signText(text: string) {
      const key = await crypto.subtle.importKey("pkcs8", base64ToArrayBuffer(privateKey),
        { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      return arrayBufferToBase64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(text)));
    },
  };
}

export async function getLocalEndorsementSigner(): Promise<EndorsementSigner | null> {
  try {
    const { getCurrentUser, getCachedPrivateKey } = await import("@/lib/auth");
    const user = getCurrentUser();
    if (!user?.id || !user.publicKey) return null;
    const privateKey = await getCachedPrivateKey();
    return privateKey ? endorsementSignerFromKeys(user.id, user.publicKey, privateKey) : null;
  } catch {
    return null;
  }
}

export async function signEndorsement(
  block: Pick<SwarmBlock, "hash" | "index" | "epoch" | "tick">,
  agree: boolean,
  signer: EndorsementSigner,
  observedAt: number,
): Promise<Endorsement> {
  const unsigned = {
    network: ENDORSEMENT_NETWORK, blockHash: block.hash, height: block.index,
    epoch: block.epoch ?? 0, round: block.tick ?? 0, agree,
    voter: signer.userId, publicKey: signer.publicKey, observedAt, clockSession: CLOCK_SESSION,
  };
  return { ...unsigned, signature: await signer.signText(payload(unsigned)) };
}

export async function verifyEndorsement(e: unknown): Promise<boolean> {
  const x = e as Endorsement | null;
  if (!x || x.network !== ENDORSEMENT_NETWORK || typeof x.blockHash !== "string" || typeof x.agree !== "boolean") return false;
  if (![x.height, x.epoch, x.round, x.observedAt].every(Number.isSafeInteger)) return false;
  if (typeof x.voter !== "string" || typeof x.publicKey !== "string" || typeof x.signature !== "string") return false;
  if (typeof x.clockSession !== "string" || x.clockSession.length > 64) return false;
  try {
    if (await computeUserId(x.publicKey) !== x.voter) return false;
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(x.publicKey),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const { signature, ...unsigned } = x;
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      base64ToArrayBuffer(signature), new TextEncoder().encode(payload(unsigned)));
  } catch {
    return false;
  }
}

// ── One agreement per height, saved before sending ──────────────────

const VOTED_KEY = "swarm-endorsed-heights-v1";
const MAX_REMEMBERED_HEIGHTS = 2_000;

type Store = Pick<Storage, "getItem" | "setItem">;
function defaultStore(): Store | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/**
 * Claim `height` for `blockHash` before endorsing it. Returns false when this
 * peer already agreed to a different block at that height. The claim is
 * written to storage first, so a restart can't undo it.
 */
export function claimHeight(height: number, blockHash: string, store: Store | null = defaultStore()): boolean {
  let voted: Record<string, string> = {};
  try { voted = JSON.parse(store?.getItem(VOTED_KEY) ?? "{}") ?? {}; } catch { voted = {}; }
  const prior = voted[String(height)];
  if (prior) return prior === blockHash;
  voted[String(height)] = blockHash;
  const heights = Object.keys(voted).map(Number).sort((a, b) => a - b);
  for (const h of heights.slice(0, Math.max(0, heights.length - MAX_REMEMBERED_HEIGHTS))) delete voted[String(h)];
  // If storage fails we can't promise once-per-height across restarts: don't endorse.
  try { store?.setItem(VOTED_KEY, JSON.stringify(voted)); } catch { return false; }
  return !!store;
}

// ── Certificates: endorsements kept beside blocks ───────────────────

export interface Certificate {
  blockHash: string;
  signed: Endorsement[];
  declined: Endorsement[];
}

const CERT_KEY = "swarm-block-certificates-v1";
const MAX_CERTIFICATES = 500;

export class CertificateBook {
  private certs = new Map<string, Certificate>();

  constructor(private store: Store | null = defaultStore()) {
    try {
      const saved = JSON.parse(store?.getItem(CERT_KEY) ?? "[]") as Certificate[];
      for (const c of saved) if (c?.blockHash) this.certs.set(c.blockHash, c);
    } catch { /* start empty */ }
  }

  /** Add a verified endorsement. Each voter counts once per block; the producer never counts. Returns true if new. */
  add(e: Endorsement, producer?: string): boolean {
    if (producer && e.voter === producer) return false;
    const cert = this.certs.get(e.blockHash) ?? { blockHash: e.blockHash, signed: [], declined: [] };
    if (cert.signed.some((x) => x.voter === e.voter) || cert.declined.some((x) => x.voter === e.voter)) return false;
    (e.agree ? cert.signed : cert.declined).push(e);
    this.certs.delete(e.blockHash);
    this.certs.set(e.blockHash, cert);
    while (this.certs.size > MAX_CERTIFICATES) {
      const oldest = this.certs.keys().next().value;
      if (oldest === undefined) break;
      this.certs.delete(oldest);
    }
    this.save();
    return true;
  }

  get(blockHash: string): Certificate | null {
    return this.certs.get(blockHash) ?? null;
  }

  /** Who signed, who declined, and which expected witnesses never answered. */
  summary(blockHash: string, expected: string[] = []): { signed: string[]; declined: string[]; missing: string[] } {
    const cert = this.get(blockHash);
    const signed = cert?.signed.map((e) => e.voter) ?? [];
    const declined = cert?.declined.map((e) => e.voter) ?? [];
    const answered = new Set([...signed, ...declined]);
    return { signed, declined, missing: expected.filter((v) => !answered.has(v)) };
  }

  private save(): void {
    try { this.store?.setItem(CERT_KEY, JSON.stringify([...this.certs.values()])); } catch { /* best effort */ }
  }
}

let book: CertificateBook | null = null;
export function getCertificateBook(): CertificateBook {
  if (!book) book = new CertificateBook();
  return book;
}
