import { arrayBufferToBase64, base64ToArrayBuffer, computeUserId } from "@/lib/crypto";
import type { SwarmTransaction } from "../types";
import { isNativeMintMeTip } from "./nativeMintmeLedger";
import { isNativeEthTip } from "./nativeEth";
import { isCustomTokenTip } from "../deposits/customTokenTips";
import { hasValidTipWeight } from "./tipWeight";
import { INFINITY_GIFT_VAULT } from "../infinity/vaults";
import { canonicalJsonBytes } from "@/lib/utils/canonicalJson";

function fields(tx: SwarmTransaction) {
  return {
    id: tx.id, type: tx.type, from: tx.from, to: tx.to, amount: tx.amount,
    tokenId: tx.tokenId ?? null, chainId: tx.chainId ?? "SWARM",
    timestamp: tx.timestamp, nonce: tx.nonce, fee: tx.fee, meta: tx.meta,
  };
}

/** Original encoding: depends on the key order of `meta` as it arrived. */
function legacyPayload(tx: SwarmTransaction): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(fields(tx)));
}

/** Order-independent encoding (sorted keys at every level). */
function canonicalPayload(tx: SwarmTransaction): Uint8Array<ArrayBuffer> {
  return canonicalJsonBytes(fields(tx)) as Uint8Array<ArrayBuffer>;
}

/**
 * Peers running older builds only verify the legacy encoding, so tips are
 * still SIGNED that way for now. Verification already accepts both; flip this
 * once a release with dual verification has rolled out to the mesh.
 */
export const SIGN_TIPS_CANONICALLY = false;

function payload(tx: SwarmTransaction): Uint8Array<ArrayBuffer> {
  return SIGN_TIPS_CANONICALLY ? canonicalPayload(tx) : legacyPayload(tx);
}

export async function signWalletTip(tx: SwarmTransaction, privateKey: string): Promise<SwarmTransaction> {
  // Identity keys use the same P-256 encoding; import for signing without exporting a new key.
  const key = await crypto.subtle.importKey("pkcs8", base64ToArrayBuffer(privateKey),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, payload(tx));
  return { ...tx, signature: arrayBufferToBase64(signature) };
}

export async function verifyWalletTip(tx: SwarmTransaction): Promise<boolean> {
  try {
    if (tx.type !== "wallet_tip" || await computeUserId(tx.publicKey) !== tx.from) return false;
    if (!Number.isFinite(tx.amount) || (tx.amount ?? 0) <= 0 || tx.from === tx.to || tx.fee !== 0) return false;
    if (tx.tokenId || (tx.chainId ?? "SWARM") !== "SWARM") return false;
    if (tx.meta?.assetId !== "chain:SWARM" && !isNativeMintMeTip(tx) && !isNativeEthTip(tx) && !isCustomTokenTip(tx)) return false;
    if (tx.meta?.assetId === "chain:SWARM" && tx.meta?.currency === "MINTME") return false;
    // The weight is inside the signed meta; format 2 must name a known tier and only SWARM carries one.
    if (!hasValidTipWeight(tx)) return false;
    if ((!/^[a-f0-9]{16}$/.test(tx.to) && tx.to !== INFINITY_GIFT_VAULT) || !tx.id || tx.id.length > 128 || !Number.isSafeInteger(tx.nonce)) return false;
    if (!Number.isFinite(Date.parse(tx.timestamp))) return false;
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(tx.publicKey),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const sig = base64ToArrayBuffer(tx.signature);
    for (const p of [canonicalPayload(tx), legacyPayload(tx)]) {
      if (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, p)) return true;
    }
    return false;
  } catch { return false; }
}

/**
 * Check that `tx` is signed by the identity key that owns `tx.from`, in
 * either encoding. Used for ledger entries other than tips that move a
 * member's SWARM, so peers never accept a spend its owner did not sign.
 */
export async function verifyLedgerSignature(tx: SwarmTransaction): Promise<boolean> {
  try {
    if (!tx.publicKey || !tx.signature || await computeUserId(tx.publicKey) !== tx.from) return false;
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(tx.publicKey),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const sig = base64ToArrayBuffer(tx.signature);
    for (const p of [canonicalPayload(tx), legacyPayload(tx)]) {
      if (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, p)) return true;
    }
    return false;
  } catch { return false; }
}

/** A member's Support the Vault donation, well formed and signed by the donor. */
export async function verifyPoolDonation(tx: SwarmTransaction): Promise<boolean> {
  if (tx.type !== "pool_donate" || tx.to !== "community-pool" || !tx.from || tx.from === "system") return false;
  if (!Number.isFinite(tx.amount) || (tx.amount ?? 0) <= 0 || tx.fee !== 0) return false;
  if (tx.tokenId || (tx.chainId ?? "SWARM") !== "SWARM") return false;
  if (!tx.id || tx.id.length > 128 || !Number.isSafeInteger(tx.nonce) || !Number.isFinite(Date.parse(tx.timestamp))) return false;
  return verifyLedgerSignature(tx);
}

/**
 * A member's Credits or token gift to the Market Vault, as Support the Vault
 * records it. The donor's own device writes it, so it may travel to peers
 * before it is mined only when the donor signed it.
 */
export function isVaultDonationRecord(tx: Pick<SwarmTransaction, "type" | "from" | "to" | "meta"> | null | undefined): boolean {
  return !!tx && tx.type === "custom_token_transfer" && tx.to === "community-pool"
    && !!tx.from && tx.from !== "system" && tx.from !== "community-pool"
    && tx.meta?.marketVault === true && tx.meta?.direction === "donation";
}

/** A Support the Vault Credits or token donation, well formed and signed by the donor. */
export async function verifyVaultDonation(tx: SwarmTransaction): Promise<boolean> {
  if (!isVaultDonationRecord(tx)) return false;
  if (!Number.isFinite(tx.amount) || (tx.amount ?? 0) <= 0 || tx.fee !== 0) return false;
  if (typeof tx.meta?.currency !== "string" || !tx.meta.currency) return false;
  if (!tx.id || tx.id.length > 128 || !Number.isSafeInteger(tx.nonce) || !Number.isFinite(Date.parse(tx.timestamp))) return false;
  return verifyLedgerSignature(tx);
}
