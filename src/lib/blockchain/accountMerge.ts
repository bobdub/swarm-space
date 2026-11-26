/**
 * Sovereign account merge: the ledger and identity side.
 *
 * The RETIRING identity (the account being closed) does the signing that
 * only it can do:
 *   1. tips every spendable asset to the master automatically with signed
 *      ledger transactions (SWARM, native MINTME, imported tokens such as
 *      Dreams and any other tippable asset as `wallet_tip` transfers, Credits
 *      as one credit transfer) and, when it holds MINTME on the MintMe chain
 *      itself, sends those coins on-chain to the master's cold-key receiving
 *      address. Imported tokens still waiting on their first peer sync block
 *      the merge before anything moves, and their definitions travel with the
 *      bundle so the master's wallet lists them;
 *   2. signs an `account_merged` attestation naming the master;
 *   3. exports its posts, favorites and contacts for the master;
 *   4. after the master acknowledges, signs an `account_tombstone` and
 *      retires its recovery vault.
 *
 * The MASTER verifies the attestation, accepts the transfers, re-attributes
 * the posts (each carrying the attestation as `mergedFrom`), records the
 * retiring id in its linked aliases table and signs an acknowledgement.
 *
 * What is NOT atomic, stated plainly: the two devices are separate ledgers
 * joined by the mesh. Each transfer is individually signed and verified, and
 * retirement is signed only after the master acknowledges, so a dropped link
 * leaves the retiring account alive (with whatever already moved) rather
 * than half-retired. An on-chain MintMe send is a real MintMe transaction;
 * the master's ledger credits it through the normal deposit sync once MintMe
 * confirms it, not instantly.
 */

import type { AccountMergedAttestation, Post } from "@/types";
import type { SwarmTransaction } from "./types";
import type { TipAsset } from "./wallets/tipRules";
import type { CustomToken } from "./deposits/customTokens";
import { arrayBufferToBase64, base64ToArrayBuffer, computeUserId, unwrapPrivateKey } from "../crypto";
import { canonicalJsonBytes } from "../utils/canonicalJson";
import { customTipAssetId, CUSTOM_TIP_ASSET_PREFIX } from "./deposits/customTokenTips";
import { get, getAll, put } from "../store";

export type { AccountMergedAttestation } from "@/types";

/** Signed by the MASTER identity key: "I accept this merge". */
export interface MasterMergeAck {
  type: "account_merge_ack";
  version: 1;
  masterId: string;
  retiringId: string;
  /** Binds the ack to the exact attestation the master verified. */
  attestationSignature: string;
  timestamp: string;
  signerPublicKey: string;
  signature: string;
}

export interface MergeAccountSummary {
  userId: string;
  username: string;
  displayName?: string;
  discriminator: string | null;
  createdAt: string;
  swarm: number;
  credits: number;
  mintme: number;
  posts: number;
  contacts: number;
  /** Public cold-key receiving address (MintMe), when known. */
  coldAddress: string | null;
  /**
   * Every other asset with a balance: imported tokens (Dreams, MTCG, …),
   * deposited ETH and the like. `moves` is false for assets a merge cannot
   * tip (creator tokens, sub-chain balances, unbridged records); `pending`
   * marks an imported token whose deposit has not synced to a peer yet.
   * Optional: older peers do not send it.
   */
  extraAssets?: MergeExtraAsset[];
  /** Guests cannot merge; they must create an account first. */
  guest?: boolean;
}

export interface MergeExtraAsset {
  id: string;
  ticker: string;
  balance: number;
  moves: boolean;
  pending?: boolean;
}

export interface MergeUnionData {
  posts: Post[];
  favorites: string[];
  connections: Array<{ userId: string; name?: string }>;
  library: Array<{ peerId: string; alias?: string }>;
}

export interface MergeUnionBundle extends MergeUnionData {
  attestation: AccountMergedAttestation;
  /** Signed ledger transactions (SWARM / MINTME wallet transfers). */
  txs: SwarmTransaction[];
  /** On-chain MintMe hand-over, when one was sent. */
  mintmeOnChain?: { hash: string; amount: number } | null;
  /** Imported token definitions (contract, symbol, decimals) the master's wallet should list. */
  tokens?: CustomToken[];
  /**
   * The retiring account's custody sync records for the imported tokens it
   * tipped, so the master's ledger can settle those tips without waiting for
   * the next mesh replay. Each is re-verified on the master.
   */
  custody?: SwarmTransaction[];
}

export interface MergeIdentityRef {
  userId: string;
  username: string;
  displayName?: string;
  publicKey: string;
  coldAddress?: string | null;
}

/** Above this many authored posts the merge is refused before anything moves. */
export const MAX_MERGE_POSTS = 20_000;
/** Signed transfer ids an attestation may list (this merge plus earlier attempts). */
export const MAX_MERGE_TX_IDS = 64;
const MERGE_MESSAGE_PREFIX = "Account merge into @";
const MINTME_CONFIRMATIONS = 6;
export const MAX_MERGE_CONTACTS = 1000;
/** Imported token definitions and custody records a bundle may carry. */
export const MAX_MERGE_TOKENS = 64;
export const MAX_MERGE_CUSTODY_RECORDS = 512;
export const GUEST_MERGE_MESSAGE = "Guests cannot merge accounts. Create an account first, then merge.";
const ALIASES_KEY = (masterId: string) => `account:aliases:${masterId}`;
const RETIRED_KEY = (userId: string) => `account-merge:retired:${userId}`;

// ── Signing helpers (identity P-256 key, base64 PKCS#8 / SPKI or raw) ──

function toBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

async function signBytes(privateKey: string, bytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", base64ToArrayBuffer(privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return arrayBufferToBase64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, toBuffer(bytes)));
}

async function verifyBytes(publicKey: string, signature: string, bytes: Uint8Array): Promise<boolean> {
  const raw = base64ToArrayBuffer(publicKey);
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("spki", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    key = await crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64ToArrayBuffer(signature), toBuffer(bytes));
}

function attestationPayload(a: Omit<AccountMergedAttestation, "signature" | "signerPublicKey">): Uint8Array {
  return canonicalJsonBytes({
    type: a.type,
    version: a.version,
    retiringId: a.retiringId,
    masterId: a.masterId,
    timestamp: a.timestamp,
    transfers: {
      swarm: a.transfers.swarm,
      credits: a.transfers.credits,
      mintme: a.transfers.mintme,
      txIds: [...a.transfers.txIds],
    },
  });
}

function ackPayload(a: Omit<MasterMergeAck, "signature" | "signerPublicKey">): Uint8Array {
  return canonicalJsonBytes({
    type: a.type,
    version: a.version,
    masterId: a.masterId,
    retiringId: a.retiringId,
    attestationSignature: a.attestationSignature,
    timestamp: a.timestamp,
  });
}

const isText = (v: unknown, max = 1024): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export async function signMergeAttestation(input: {
  retiringId: string;
  masterId: string;
  transfers: AccountMergedAttestation["transfers"];
  privateKey: string;
  publicKey: string;
  timestamp?: string;
}): Promise<AccountMergedAttestation> {
  if (input.retiringId === input.masterId) throw new Error("An account cannot merge into itself.");
  const unsigned = {
    type: "account_merged" as const,
    version: 1 as const,
    retiringId: input.retiringId,
    masterId: input.masterId,
    timestamp: input.timestamp ?? new Date().toISOString(),
    transfers: { ...input.transfers, txIds: [...input.transfers.txIds] },
  };
  const signature = await signBytes(input.privateKey, attestationPayload(unsigned));
  return { ...unsigned, signerPublicKey: input.publicKey, signature };
}

/** Valid when the signer key hashes to `retiringId` and the signature covers the payload. */
export async function verifyMergeAttestation(value: unknown): Promise<boolean> {
  if (!value || typeof value !== "object") return false;
  const a = value as AccountMergedAttestation;
  if (a.type !== "account_merged" || a.version !== 1) return false;
  if (!isText(a.retiringId, 128) || !isText(a.masterId, 128) || a.retiringId === a.masterId) return false;
  if (!isText(a.timestamp, 64) || !Number.isFinite(Date.parse(a.timestamp))) return false;
  if (!isText(a.signerPublicKey) || !isText(a.signature)) return false;
  const t = a.transfers;
  if (!t || !isAmount(t.swarm) || !isAmount(t.credits) || !isAmount(t.mintme)) return false;
  if (!Array.isArray(t.txIds) || t.txIds.length > MAX_MERGE_TX_IDS || t.txIds.some((id) => !isText(id, 256))) return false;
  try {
    if ((await computeUserId(a.signerPublicKey)) !== a.retiringId) return false;
    return await verifyBytes(a.signerPublicKey, a.signature, attestationPayload(a));
  } catch {
    return false;
  }
}

export async function signMasterAck(input: {
  attestation: AccountMergedAttestation;
  privateKey: string;
  publicKey: string;
  timestamp?: string;
}): Promise<MasterMergeAck> {
  const unsigned = {
    type: "account_merge_ack" as const,
    version: 1 as const,
    masterId: input.attestation.masterId,
    retiringId: input.attestation.retiringId,
    attestationSignature: input.attestation.signature,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  const signature = await signBytes(input.privateKey, ackPayload(unsigned));
  return { ...unsigned, signerPublicKey: input.publicKey, signature };
}

/** Valid when signed by the master named in `attestation` and bound to that attestation. */
export async function verifyMasterAck(value: unknown, attestation: AccountMergedAttestation): Promise<boolean> {
  if (!value || typeof value !== "object") return false;
  const a = value as MasterMergeAck;
  if (a.type !== "account_merge_ack" || a.version !== 1) return false;
  if (a.masterId !== attestation.masterId || a.retiringId !== attestation.retiringId) return false;
  if (a.attestationSignature !== attestation.signature) return false;
  if (!isText(a.timestamp, 64) || !isText(a.signerPublicKey) || !isText(a.signature)) return false;
  try {
    if ((await computeUserId(a.signerPublicKey)) !== a.masterId) return false;
    return await verifyBytes(a.signerPublicKey, a.signature, ackPayload(a));
  } catch {
    return false;
  }
}

// ── Guests ─────────────────────────────────────────────────────────────

async function requireMember() {
  const [{ getCurrentUser }, { isGuestUser }] = await Promise.all([import("../auth"), import("../preview/guestAccess")]);
  const user = getCurrentUser();
  if (!user) throw new Error("Sign in first.");
  if (isGuestUser(user)) throw new MergeBlockedError(GUEST_MERGE_MESSAGE);
  return user;
}

// ── Asset plan ─────────────────────────────────────────────────────────

/** Assets the sweep moves with their own dedicated legs. */
const DEDICATED_ASSETS = new Set(["credits", "chain:SWARM", "external:MINTME"]);
const IMPORTED_PREFIX = CUSTOM_TIP_ASSET_PREFIX;

export interface AssetSweepPlan {
  /** Tipped to the master automatically. */
  movable: TipAsset[];
  /** Imported tokens recorded but not spendable yet: the merge waits for them. */
  pendingImported: TipAsset[];
  /** Held but not tippable (creator tokens, sub-chains, unbridged records). */
  staying: TipAsset[];
}

/**
 * Sort a wallet's assets (as `getWalletTipAssets` lists them) into what the
 * merge tips across, what must sync first, and what stays behind. SWARM,
 * native MINTME and Credits have dedicated legs and are left out.
 */
export function planAssetSweep(assets: readonly TipAsset[]): AssetSweepPlan {
  const plan: AssetSweepPlan = { movable: [], pendingImported: [], staying: [] };
  for (const asset of assets) {
    if (DEDICATED_ASSETS.has(asset.id)) continue;
    if (asset.id.startsWith(IMPORTED_PREFIX) && asset.unavailable) {
      plan.pendingImported.push(asset);
    } else if (!(asset.balance > 0)) {
      continue;
    } else if (asset.unavailable) {
      plan.staying.push(asset);
    } else {
      plan.movable.push(asset);
    }
  }
  return plan;
}

function extraAssetsOf(plan: AssetSweepPlan): MergeExtraAsset[] {
  return [
    ...plan.movable.map((a) => ({ id: a.id, ticker: a.ticker, balance: a.balance, moves: true })),
    ...plan.pendingImported.map((a) => ({ id: a.id, ticker: a.ticker, balance: a.balance, moves: true, pending: true })),
    ...plan.staying.map((a) => ({ id: a.id, ticker: a.ticker, balance: a.balance, moves: false })),
  ];
}

// ── Password gate ──────────────────────────────────────────────────────

/**
 * Unlock the signed-in account's identity key with its LOCAL password. The
 * password must be typed even when the key is already cached, because the
 * merge is authorised per device. Returns the private key (kept in memory).
 */
export async function unlockForMerge(password: string): Promise<string> {
  const user = await requireMember();
  const { loginUser } = await import("../auth");
  const entry = await get<{ k: string; v: { wrapped: string; salt: string | null; iv: string | null; rawStored?: boolean } }>("meta", user.wrappedKeyRef);
  if (!entry?.v) throw new Error("This device has no key for this account.");
  if (entry.v.rawStored || !entry.v.salt || !entry.v.iv) {
    throw new Error("This account has no local password on this device. Set one under Local account password first.");
  }
  let privateKey: string;
  try {
    privateKey = await unwrapPrivateKey({ wrapped: entry.v.wrapped, salt: entry.v.salt, iv: entry.v.iv }, password.trim());
  } catch {
    throw new Error("That password does not unlock this account.");
  }
  // Also cache it, so the wallet signing paths used below see it unlocked.
  await loginUser(password.trim()).catch(() => null);
  return privateKey;
}

// ── Account summary (comparison matrix) ────────────────────────────────

async function authoredPosts(userId: string): Promise<Post[]> {
  try {
    return (await getAll<Post>("posts")).filter((p) => p?.author === userId);
  } catch {
    return [];
  }
}

export async function buildAccountSummary(): Promise<MergeAccountSummary> {
  const user = await requireMember();
  const [{ getWalletTipAssets }, { getConnectedUserIds }] = await Promise.all([
    import("./wallets/walletTips"),
    import("../connections"),
  ]);
  const assets = await getWalletTipAssets(user.id).catch(() => []);
  const balance = (id: string) => assets.find((a) => a.id === id)?.balance ?? 0;
  let coldAddress: string | null = null;
  let discriminator: string | null = null;
  try {
    const { getColdKeyReceivingAddress } = await import("./wallets/coldKey");
    coldAddress = await getColdKeyReceivingAddress(user.id);
    const { namespaceIdentity } = await import("../uqrc/namespaceIdentity");
    discriminator = (await namespaceIdentity(user.id, coldAddress)).discriminator;
  } catch {
    /* locked with no remembered address */
  }
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    discriminator,
    createdAt: user.createdAt,
    swarm: balance("chain:SWARM"),
    credits: balance("credits"),
    mintme: balance("external:MINTME"),
    posts: (await authoredPosts(user.id)).length,
    contacts: (await getConnectedUserIds(user.id).catch(() => [] as string[])).length,
    coldAddress,
    extraAssets: extraAssetsOf(planAssetSweep(assets)),
    guest: false,
  };
}

// ── Retiring side ──────────────────────────────────────────────────────

export class MergeBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeBlockedError";
  }
}

export interface AssetSweepResult {
  swarm: number;
  credits: number;
  mintme: number;
  txs: SwarmTransaction[];
  creditTxId: string | null;
  mintmeOnChain: { hash: string; amount: number } | null;
  /** MINTME left at the retiring cold address (dust below the gas hold). */
  mintmeLeftOnChain: number;
  /** Every other asset tipped across (imported tokens such as Dreams, ETH, …). */
  extras: Array<{ assetId: string; ticker: string; amount: number }>;
  /** Assets that could not be tipped and stay with the retiring account. */
  staying: Array<{ assetId: string; ticker: string; amount: number }>;
  /** Imported token definitions for the master's wallet. */
  tokens: CustomToken[];
  /** Custody sync records backing the imported-token tips. */
  custody: SwarmTransaction[];
}

/**
 * MINTME sitting on the MintMe chain at the retiring cold-key address can
 * only move with a real MintMe transaction signed by that key. Do it first,
 * before anything else is signed, so a failure blocks the merge cleanly.
 */
async function moveOnChainMintMe(retiringId: string, masterCold: string | null | undefined): Promise<{ moved: { hash: string; amount: number } | null; left: number }> {
  const { getSwarmChain } = await import("./chain");
  const chain = getSwarmChain();
  await chain.whenReady();
  const [{ getColdKeyReceivingAddress, getColdKeyAuthority }, { mintMeReadProvider }, { mintMeAmount }, { MINTME_GAS_HOLD_UNITS, syncNativeMintMeDeposits, withdrawNativeMintMe }] = await Promise.all([
    import("./wallets/coldKey"),
    import("./wallets/nativeMintmeCustody"),
    import("./wallets/nativeMintmeLedger"),
    import("./wallets/nativeMintmeDirect"),
  ]);
  // Read the chain whatever the ledger says: MINTME can sit at the cold
  // address before (or without) being credited, and the key leaves with
  // this account.
  const address = await getColdKeyReceivingAddress(retiringId);
  let held: bigint;
  let confirmed: bigint;
  const provider = mintMeReadProvider();
  try {
    const tip = await provider.getBlockNumber();
    [held, confirmed] = await Promise.all([
      provider.getBalance(address),
      provider.getBalance(address, Math.max(0, tip - MINTME_CONFIRMATIONS)),
    ]);
  } catch {
    throw new MergeBlockedError("Could not reach the MintMe network to check this account's MINTME. Nothing was moved. Try again in a moment.");
  } finally {
    provider.destroy();
  }
  if (held <= MINTME_GAS_HOLD_UNITS) return { moved: null, left: mintMeAmount(held) };
  if (held > confirmed) {
    throw new MergeBlockedError(`MINTME arrived at this account's MintMe address and is still confirming (MintMe needs ${MINTME_CONFIRMATIONS} confirmations). Wait a few minutes and try again. Nothing was moved.`);
  }
  // Record any confirmed arrival the ledger has not credited yet, so the
  // send below (which debits the ledger) can cover every coin at the address.
  let ledgerUnits = chain.getNativeMintMeBalanceUnits(retiringId);
  if (ledgerUnits < held) {
    await syncNativeMintMeDeposits(retiringId).catch(() => 0);
    ledgerUnits = chain.getNativeMintMeBalanceUnits(retiringId);
  }
  // A ledger below the on-chain amount after syncing means part of these
  // coins was already given away as native MINTME tips (claims held by
  // others); only this account's own share moves.
  const backed = held < ledgerUnits ? held : ledgerUnits;
  if (backed <= MINTME_GAS_HOLD_UNITS) return { moved: null, left: mintMeAmount(held) };
  if (!masterCold) {
    throw new MergeBlockedError("The master account's MintMe receiving address is not known yet. Open Wallet once on the master device, then try again. Nothing was moved.");
  }
  if (!(await getColdKeyAuthority(retiringId))) {
    throw new MergeBlockedError(`This account holds ${mintMeAmount(held)} MINTME on MintMe but has no cold-wallet key authority to send it. Engrave the key in Wallet (or withdraw it) first. Nothing was moved.`);
  }
  const amount = mintMeAmount(backed - MINTME_GAS_HOLD_UNITS);
  const hash = await withdrawNativeMintMe({ userId: retiringId, to: masterCold, amount });
  return { moved: { hash, amount }, left: Math.max(0, mintMeAmount(held) - amount) };
}

async function priorMergeTransfers(retiringId: string, masterId: string): Promise<SwarmTransaction[]> {
  const { getSwarmChain } = await import("./chain");
  const chain = getSwarmChain();
  await chain.whenReady();
  const seen = new Set<string>();
  const out: SwarmTransaction[] = [];
  for (const tx of [...chain.getChain().flatMap((b) => b.transactions), ...chain.getPendingTransactions()]) {
    if (tx.type !== "wallet_tip" || tx.from !== retiringId || tx.to !== masterId || seen.has(tx.id)) continue;
    if (typeof tx.meta?.message !== "string" || !tx.meta.message.startsWith(MERGE_MESSAGE_PREFIX)) continue;
    seen.add(tx.id);
    out.push(tx);
  }
  return out;
}

/**
 * Move every spendable balance from the signed-in (retiring) account to
 * the master. Each leg is its own signed, verified ledger entry.
 */
export async function sweepAssetsToMaster(master: MergeIdentityRef, onStep?: (step: string) => void): Promise<AssetSweepResult> {
  const user = await requireMember();
  if (user.id === master.userId) throw new Error("An account cannot merge into itself.");

  const authored = (await authoredPosts(user.id)).length;
  if (authored > MAX_MERGE_POSTS) {
    throw new MergeBlockedError(`This account has ${authored} posts; a merge supports up to ${MAX_MERGE_POSTS}. Nothing was moved.`);
  }

  // Imported tokens (Dreams and friends) first: a deposit that has not been
  // shared with a peer yet is not spendable, and the master is connected
  // right now, so unlock it. Anything still pending blocks the merge before
  // any coin moves, so no imported balance is left behind a tombstone.
  onStep?.("Checking imported tokens");
  const deposits = await import("./deposits/customTokens");
  await deposits.hydrateCustomTokens(user.id).catch(() => []);
  await deposits.syncPendingDeposits(user.id).catch(() => false);
  const { getWalletTipAssets: listAssets } = await import("./wallets/walletTips");
  const pending = planAssetSweep(await listAssets(user.id)).pendingImported;
  if (pending.length > 0) {
    const names = pending.map((a) => a.ticker).join(", ");
    throw new MergeBlockedError(`This account's ${names} deposit has not synced to a peer yet, so it cannot be tipped to the master. Keep both devices connected for a minute and try again. Nothing was moved.`);
  }

  onStep?.("Checking MINTME on the MintMe network");
  const onChain = await moveOnChainMintMe(user.id, master.coldAddress);

  // The master must be a known wallet recipient on this device.
  const { hydrateNativeWalletPeer } = await import("./wallets/nativeAddress");
  await hydrateNativeWalletPeer({ userId: master.userId, username: master.username, displayName: master.displayName });

  const { getWalletTipAssets, sendWalletTip } = await import("./wallets/walletTips");
  const message = `${MERGE_MESSAGE_PREFIX}${master.username}`;
  // Transfers from an earlier, interrupted attempt ride along again, so the
  // master must hold every one before it acknowledges.
  const txs: SwarmTransaction[] = await priorMergeTransfers(user.id, master.userId);
  let swarm = 0;
  let mintme = 0;
  const assets = await getWalletTipAssets(user.id);

  const swarmAsset = assets.find((a) => a.id === "chain:SWARM");
  if (swarmAsset && swarmAsset.balance > 0) {
    onStep?.(`Transferring ${swarmAsset.balance} SWARM`);
    const tx = await sendWalletTip({ recipient: master.userId, assetId: "chain:SWARM", amount: swarmAsset.balance, intent: "transfer", message });
    if (tx) txs.push(tx);
    swarm = swarmAsset.balance;
  }

  // Re-read: an on-chain MintMe send above already debited its share.
  const mintmeAsset = (await getWalletTipAssets(user.id)).find((a) => a.id === "external:MINTME");
  if (mintmeAsset && mintmeAsset.balance > 0 && !mintmeAsset.unavailable) {
    onStep?.(`Transferring ${mintmeAsset.balance} MINTME ledger balance`);
    const tx = await sendWalletTip({ recipient: master.userId, assetId: "external:MINTME", amount: mintmeAsset.balance, intent: "transfer", message });
    if (tx) txs.push(tx);
    mintme = mintmeAsset.balance;
  }

  // Every other tippable asset: imported tokens such as Dreams, deposited
  // ETH and the like. Each is an ordinary signed wallet transfer.
  const plan = planAssetSweep(await getWalletTipAssets(user.id));
  const extras: AssetSweepResult["extras"] = [];
  for (const asset of plan.movable) {
    onStep?.(`Transferring ${asset.balance} ${asset.ticker}`);
    const tx = await sendWalletTip({ recipient: master.userId, assetId: asset.id, amount: asset.balance, intent: "transfer", message });
    if (tx) txs.push(tx);
    extras.push({ assetId: asset.id, ticker: asset.ticker, amount: asset.balance });
  }
  const movedImported = new Set(extras.filter((e) => e.assetId.startsWith(IMPORTED_PREFIX)).map((e) => e.assetId));
  const tokens = deposits.listCustomTokens(user.id)
    .filter((t) => movedImported.has(customTipAssetId(deposits.customTokenRef(t))))
    .slice(0, MAX_MERGE_TOKENS);
  const custody = movedImported.size > 0 ? await custodyRecordsFor(user.id, movedImported) : [];

  const { getCreditBalance, transferCreditsForAccountMerge } = await import("../credits");
  const creditBalance = await getCreditBalance(user.id);
  let creditTxId: string | null = null;
  if (creditBalance > 0) {
    onStep?.(`Transferring ${creditBalance} Credits`);
    creditTxId = (await transferCreditsForAccountMerge(master.userId, creditBalance, { message })).id;
  }

  if (txs.length > MAX_MERGE_TX_IDS - 1) throw new Error("Too many merge transfers to list in one attestation.");
  return {
    swarm,
    credits: creditBalance > 0 ? creditBalance : 0,
    mintme: mintme + (onChain.moved?.amount ?? 0),
    txs,
    creditTxId,
    mintmeOnChain: onChain.moved,
    mintmeLeftOnChain: onChain.left,
    extras,
    staying: plan.staying.map((a) => ({ assetId: a.id, ticker: a.ticker, amount: a.balance })),
    tokens,
    custody,
  };
}

/** The retiring account's custody sync records for the given imported-token asset ids, oldest first. */
async function custodyRecordsFor(userId: string, assetIds: Set<string>): Promise<SwarmTransaction[]> {
  const [{ getSwarmChain }, { isCustomTokenSync, syncRecordRef }] = await Promise.all([
    import("./chain"),
    import("./deposits/customTokenCustody"),
  ]);
  const chain = getSwarmChain();
  await chain.whenReady();
  const seen = new Set<string>();
  const out: SwarmTransaction[] = [];
  for (const tx of [...chain.getChain().flatMap((b) => b.transactions), ...chain.getPendingTransactions()]) {
    if (seen.has(tx.id) || tx.to !== userId || !isCustomTokenSync(tx)) continue;
    const ref = syncRecordRef(tx);
    if (!ref || !assetIds.has(customTipAssetId(ref))) continue;
    seen.add(tx.id);
    out.push(tx);
  }
  return out.slice(-MAX_MERGE_CUSTODY_RECORDS);
}

export async function collectUnionData(retiringId: string): Promise<MergeUnionData> {
  const posts = await authoredPosts(retiringId);
  if (posts.length > MAX_MERGE_POSTS) throw new MergeBlockedError(`This account has ${posts.length} posts; a merge supports up to ${MAX_MERGE_POSTS}.`);
  let favorites: string[] = [];
  try {
    const { FAVORITES_STORE } = await import("../p2p/contentLifecycle");
    favorites = (await getAll<{ postId: string }>(FAVORITES_STORE)).map((f) => f.postId).filter(Boolean).slice(0, MAX_MERGE_POSTS);
  } catch { /* no favorites */ }
  let connections: MergeUnionData["connections"] = [];
  try {
    const { getUserConnections } = await import("../connections");
    connections = (await getUserConnections(retiringId)).slice(0, MAX_MERGE_CONTACTS).map((c) => {
      const other = c.userId === retiringId ? c.connectedUserId : c.userId;
      return { userId: other, ...(c.userId === retiringId && c.connectedUserName ? { name: c.connectedUserName } : {}) };
    });
  } catch { /* no connections */ }
  let library: MergeUnionData["library"] = [];
  try {
    const { getSwarmMeshStandalone } = await import("../p2p/swarmMesh.standalone");
    library = getSwarmMeshStandalone().getLibrary().slice(0, MAX_MERGE_CONTACTS).map((p) => ({ peerId: p.peerId, alias: p.alias }));
  } catch { /* mesh not started */ }
  return { posts, favorites, connections, library };
}

export interface RetiredRecord {
  retiringId: string;
  masterId: string;
  masterUsername: string;
  attestation: AccountMergedAttestation;
  ack: MasterMergeAck;
  retiredAt: string;
  tombstoned: boolean;
}

/**
 * Final, irreversible step on the retiring device, run only after the
 * master's signed acknowledgement verified: sign the account tombstone
 * (peers drop the recovery vault and the old posts) and retire the vault.
 */
export async function retireMergedAccount(input: {
  privateKey: string;
  attestation: AccountMergedAttestation;
  ack: MasterMergeAck;
  masterUsername: string;
}): Promise<RetiredRecord> {
  if (!(await verifyMasterAck(input.ack, input.attestation))) throw new Error("The master's acknowledgement did not verify. The account was not retired.");
  const { issueAccountTombstone } = await import("../p2p/contentLifecycle");
  const result = await issueAccountTombstone(input.privateKey);
  const { retireOwnVault } = await import("../backup/vaultCustody");
  await retireOwnVault(input.attestation.retiringId);
  const record: RetiredRecord = {
    retiringId: input.attestation.retiringId,
    masterId: input.attestation.masterId,
    masterUsername: input.masterUsername,
    attestation: input.attestation,
    ack: input.ack,
    retiredAt: new Date().toISOString(),
    tombstoned: !!result?.signed,
  };
  await put("meta", { k: RETIRED_KEY(record.retiringId), v: record });
  return record;
}

export async function getRetiredRecord(userId: string): Promise<RetiredRecord | null> {
  try {
    return (await get<{ k: string; v: RetiredRecord }>("meta", RETIRED_KEY(userId)))?.v ?? null;
  } catch {
    return null;
  }
}

/** "Sign out" choice: drop the retired account's local identity rows, then sign out. */
export async function removeRetiredAccountFromDevice(userId: string): Promise<void> {
  const { remove } = await import("../store");
  const user = await get<{ id: string; wrappedKeyRef?: string }>("users", userId).catch(() => undefined);
  if (user?.wrappedKeyRef) await remove("meta", user.wrappedKeyRef).catch(() => undefined);
  await remove("users", userId).catch(() => undefined);
  await remove("meta", `wallet-device-seal:${userId}`).catch(() => undefined);
}

// ── Master side ────────────────────────────────────────────────────────

export interface LinkedAlias {
  retiringId: string;
  username: string;
  mergedAt: string;
  attestation: AccountMergedAttestation;
  ack: MasterMergeAck;
}

export async function getLinkedAliases(masterId: string): Promise<LinkedAlias[]> {
  try {
    const row = await get<{ k: string; v: Record<string, LinkedAlias> }>("meta", ALIASES_KEY(masterId));
    return Object.values(row?.v ?? {});
  } catch {
    return [];
  }
}

async function recordAlias(masterId: string, alias: LinkedAlias): Promise<void> {
  const row = await get<{ k: string; v: Record<string, LinkedAlias> }>("meta", ALIASES_KEY(masterId)).catch(() => undefined);
  const table = { ...(row?.v ?? {}), [alias.retiringId]: alias };
  await put("meta", { k: ALIASES_KEY(masterId), v: table });
}

export interface MasterAcceptResult {
  ack: MasterMergeAck;
  postsReattributed: number;
  contactsAdded: number;
  favoritesAdded: number;
  txsAccepted: number;
  tokensAdded: number;
}

/** Re-attribute one of the retiring account's posts to the master. */
export function reattributePost(post: Post, master: { id: string; username: string; displayName?: string; avatarRef?: string }, attestation: AccountMergedAttestation, now = new Date().toISOString()): Post {
  const {
    signature: _sig, signatureAlgorithm: _alg, signerPublicKey: _pk, signedAt: _at,
    _syncedToMesh: _synced, authorPeerId: _peer, authorBadgeSnapshots: _badges, ...rest
  } = post;
  return {
    ...rest,
    author: master.id,
    authorName: master.displayName || master.username,
    ...(master.avatarRef ? { authorAvatarRef: master.avatarRef } : {}),
    editedAt: now,
    mergedFrom: attestation,
    _origin: "local",
  };
}

/**
 * Master device: verify and absorb the retiring account's bundle, then sign
 * the acknowledgement that lets the retiring side tombstone itself.
 */
export async function acceptMergeOnMaster(input: {
  bundle: MergeUnionBundle;
  privateKey: string;
  retiring: { userId: string; username: string };
}): Promise<MasterAcceptResult> {
  const me = await requireMember();
  const { attestation } = input.bundle;
  if (!(await verifyMergeAttestation(attestation))) throw new Error("The retiring account's merge attestation did not verify.");
  if (attestation.masterId !== me.id || attestation.retiringId !== input.retiring.userId) {
    throw new Error("The merge attestation names a different pair of accounts.");
  }

  // Ledger transfers: each is independently signature- and balance-checked.
  // Every listed wallet transfer must be recorded here (or already be)
  // before we acknowledge, because the ack lets the retiring key close for
  // good. A rejection usually means this device has not synced the retiring
  // account's ledger history yet: refuse, and the merge stays retryable.
  // Imported tokens: settle the retiring account's custody records first
  // (each re-verified here, exactly as a mesh replay would be), so its tips
  // of Dreams and other imported tokens can be checked against them.
  const custody = (input.bundle.custody ?? []).slice(0, MAX_MERGE_CUSTODY_RECORDS);
  if (custody.length > 0) {
    const [{ getSwarmChain }, { isCustomTokenSync }] = await Promise.all([import("./chain"), import("./deposits/customTokenCustody")]);
    const chain = getSwarmChain();
    await chain.whenReady();
    for (const record of custody) {
      if (!record || record.to !== attestation.retiringId || !isCustomTokenSync(record)) continue;
      await chain.acceptCustomTokenDeposit(record).catch(() => false);
    }
  }

  let txsAccepted = 0;
  const { receiveWalletTip } = await import("./wallets/walletTips");
  const listed = new Set(attestation.transfers.txIds);
  for (const tx of (input.bundle.txs ?? []).slice(0, MAX_MERGE_TX_IDS)) {
    if (!tx || !listed.has(tx.id)) continue;
    if (tx.from !== attestation.retiringId || tx.to !== me.id || !(await receiveWalletTip(tx).catch(() => false))) {
      throw new Error("This device could not record one of the retiring account's transfers yet (its ledger history has not synced here). Nothing was retired. Wait a minute with both devices connected and run the merge again.");
    }
    txsAccepted++;
  }

  // Posts: re-attributed under the master with the attestation as their link.
  const { signPost } = await import("../p2p/replication");
  const now = new Date().toISOString();
  const reattributed: Post[] = [];
  if ((input.bundle.posts ?? []).length > MAX_MERGE_POSTS) throw new Error("The retiring account sent more posts than a merge supports. Nothing was retired.");
  for (const post of input.bundle.posts ?? []) {
    if (!post || typeof post.id !== "string" || post.author !== attestation.retiringId) continue;
    const existing = await get<Post>("posts", post.id).catch(() => undefined);
    if (existing && existing.author !== attestation.retiringId && existing.author !== me.id) continue;
    const moved = reattributePost(post, { id: me.id, username: me.username, displayName: me.displayName, avatarRef: me.profile?.avatarRef }, attestation, now);
    const signed = await signPost(moved).catch(() => moved);
    await put("posts", signed);
    reattributed.push(signed);
  }
  try {
    const { getSwarmMeshStandalone } = await import("../p2p/swarmMesh.standalone");
    const mesh = getSwarmMeshStandalone();
    for (const post of reattributed) {
      if (!post._localOnly) mesh.broadcastNewPost(post as unknown as Record<string, unknown>);
    }
  } catch { /* peers pick the posts up on the next sync */ }
  if (reattributed.length > 0) {
    try { window.dispatchEvent(new Event("p2p-posts-updated")); } catch { /* non-browser */ }
  }

  // Favorites and contacts.
  let favoritesAdded = 0;
  try {
    const { isPostFavorited, setPostFavorited } = await import("../p2p/contentLifecycle");
    for (const postId of (input.bundle.favorites ?? []).slice(0, MAX_MERGE_POSTS)) {
      if (typeof postId !== "string" || (await isPostFavorited(postId))) continue;
      await setPostFavorited(postId, true);
      favoritesAdded++;
    }
  } catch { /* favorites optional */ }
  let contactsAdded = 0;
  try {
    const { createConnection, getConnectedUserIds } = await import("../connections");
    const known = new Set(await getConnectedUserIds(me.id));
    for (const c of (input.bundle.connections ?? []).slice(0, MAX_MERGE_CONTACTS)) {
      if (!c || typeof c.userId !== "string" || c.userId === me.id || c.userId === attestation.retiringId || known.has(c.userId)) continue;
      await createConnection(me.id, c.userId, typeof c.name === "string" ? c.name : undefined);
      known.add(c.userId);
      contactsAdded++;
    }
  } catch { /* contacts optional */ }
  try {
    const { getSwarmMeshStandalone } = await import("../p2p/swarmMesh.standalone");
    const mesh = getSwarmMeshStandalone();
    const have = new Set(mesh.getLibrary().map((p) => p.peerId));
    for (const entry of (input.bundle.library ?? []).slice(0, MAX_MERGE_CONTACTS)) {
      if (!entry || typeof entry.peerId !== "string" || have.has(entry.peerId)) continue;
      mesh.rememberKnownPeer(entry.peerId, typeof entry.alias === "string" ? entry.alias : undefined);
    }
  } catch { /* mesh not started */ }

  // List the imported tokens that arrived, so the master's wallet shows them.
  let tokensAdded = 0;
  if ((input.bundle.tokens ?? []).length > 0) {
    try {
      const { addCustomToken, customTokenRef, listCustomTokens } = await import("./deposits/customTokens");
      const have = new Set(listCustomTokens(me.id).map((t) => customTokenRef(t)));
      for (const token of (input.bundle.tokens ?? []).slice(0, MAX_MERGE_TOKENS)) {
        if (!token || typeof token.address !== "string") continue;
        try {
          if (have.has(customTokenRef(token))) continue;
          const added = addCustomToken(me.id, { address: token.address, symbol: token.symbol, decimals: token.decimals, ...(token.network ? { network: token.network } : {}) });
          have.add(customTokenRef(added));
          tokensAdded++;
        } catch { /* malformed definition: skipped */ }
      }
    } catch { /* token list optional */ }
  }

  const ack = await signMasterAck({ attestation, privateKey: input.privateKey, publicKey: me.publicKey });
  await recordAlias(me.id, { retiringId: attestation.retiringId, username: input.retiring.username, mergedAt: now, attestation, ack });

  // MINTME sent on-chain lands at our cold address; the deposit sync credits
  // it once MintMe confirms. Nudge it now; the wallet repeats it later.
  if (input.bundle.mintmeOnChain) {
    void import("./wallets/nativeMintmeDirect")
      .then((m) => m.syncNativeMintMeDeposits(me.id))
      .catch(() => { /* not confirmed yet */ });
  }
  try { window.dispatchEvent(new Event("blockchain-transaction")); } catch { /* non-browser */ }

  return { ack, postsReattributed: reattributed.length, contactsAdded, favoritesAdded, txsAccepted, tokensAdded };
}
