/**
 * Share my Chain: the deployer sends their coin's card to connected peers,
 * who get a notification and can add the network to their wallet.
 *
 * The card is signed with the deployer's identity P-256 key. A peer keeps an
 * offer only when the signature verifies, `computeUserId(publicKey)` is the
 * coin's deployer, and the card isn't dated in the future. Offers wait on the
 * receiving device (never auto-added) until the person adds or dismisses
 * them on Wallet > Chain. Adding stores the coin in `deployedCoins`, which is
 * what the Network Chains list and the wallet's network picker read.
 */
import { base64ToArrayBuffer, computeUserId } from "@/lib/crypto";
import { canonical } from "./cellChain/roster";
import type { DeployedCoin } from "./types";

export const COIN_SHARE_CHANNEL = "coin-chain-share";
const OFFERS_PREFIX = "coin-chain-offers-v1:";
const MAX_OFFERS = 50;
const FUTURE_LIMIT_MS = 5 * 60 * 1000;
export const COIN_OFFERS_EVENT = "coin-chain-offers-changed";

/** What travels: the public parts of a deployed coin. */
export interface SharedCoinCard {
  coinId: string;
  deployerUserId: string;
  chainName: string;
  ticker: string;
  projectGoal: string;
  maxSupply: number;
  deployedAt: string;
  bridgeAddress: string;
}

export interface CoinShareMessage {
  t: "share";
  v: 1;
  coin: SharedCoinCard;
  sharerName: string;
  at: number;
  publicKey: string;
  signature: string;
}

export interface ChainOffer {
  coin: SharedCoinCard;
  sharerName: string;
  receivedAt: number;
}

export interface ShareTransport {
  send(channel: string, peerId: string, payload: unknown): Promise<boolean> | boolean;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
  getConnectedPeerIds(): string[];
}

export interface ShareSigner {
  userId: string;
  publicKey: string;
  signText(text: string): Promise<string>;
}

function cardOf(coin: DeployedCoin): SharedCoinCard {
  return {
    coinId: coin.coinId,
    deployerUserId: coin.deployerUserId,
    chainName: coin.chainName,
    ticker: coin.ticker,
    projectGoal: coin.projectGoal,
    maxSupply: coin.maxSupply,
    deployedAt: coin.deployedAt,
    bridgeAddress: coin.bridgeAddress,
  };
}

function signedText(coin: SharedCoinCard, sharerName: string, at: number, publicKey: string): string {
  return canonical({ v: 1, type: "coin-chain-share", coin, sharerName, at, publicKey });
}

export async function signCoinShare(coin: DeployedCoin, sharerName: string, signer: ShareSigner, at = Date.now()): Promise<CoinShareMessage> {
  if (coin.deployerUserId !== signer.userId) throw new Error("Only the deployer can share this chain");
  const card = cardOf(coin);
  const name = sharerName.slice(0, 64);
  const signature = await signer.signText(signedText(card, name, at, signer.publicKey));
  return { t: "share", v: 1, coin: card, sharerName: name, at, publicKey: signer.publicKey, signature };
}

const str = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max;

function wellFormedCard(c: unknown): c is SharedCoinCard {
  const x = c as SharedCoinCard | null;
  return !!x && typeof x === "object"
    && str(x.coinId, 128) && str(x.deployerUserId, 128) && str(x.chainName, 32)
    && typeof x.ticker === "string" && /^[A-Z]{3,6}$/.test(x.ticker) && x.ticker !== "SWARM"
    && str(x.projectGoal, 500) && Number.isFinite(x.maxSupply) && x.maxSupply > 0
    && str(x.deployedAt, 64) && !Number.isNaN(Date.parse(x.deployedAt)) && str(x.bridgeAddress, 256);
}

/** The card, when the message is a well-formed share signed by the coin's deployer. */
export async function verifyCoinShare(msg: unknown, now = Date.now()): Promise<CoinShareMessage | null> {
  const m = msg as CoinShareMessage | null;
  if (!m || m.t !== "share" || m.v !== 1 || !wellFormedCard(m.coin)) return null;
  if (typeof m.sharerName !== "string" || m.sharerName.length > 64) return null;
  if (!Number.isSafeInteger(m.at) || m.at > now + FUTURE_LIMIT_MS) return null;
  if (typeof m.publicKey !== "string" || typeof m.signature !== "string") return null;
  try {
    if (await computeUserId(m.publicKey) !== m.coin.deployerUserId) return null;
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(m.publicKey),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      base64ToArrayBuffer(m.signature), new TextEncoder().encode(signedText(m.coin, m.sharerName, m.at, m.publicKey)));
    return ok ? m : null;
  } catch {
    return null;
  }
}

// ── Offers waiting on this device ────────────────────────────────────

export function listChainOffers(userId: string): ChainOffer[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OFFERS_PREFIX + userId) ?? "[]");
    return Array.isArray(raw) ? raw.filter((o) => wellFormedCard(o?.coin)) : [];
  } catch {
    return [];
  }
}

function saveOffers(userId: string, offers: ChainOffer[]): void {
  try { localStorage.setItem(OFFERS_PREFIX + userId, JSON.stringify(offers.slice(-MAX_OFFERS))); } catch { /* storage full */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(COIN_OFFERS_EVENT, { detail: { userId } }));
}

export function dismissChainOffer(userId: string, coinId: string): void {
  saveOffers(userId, listChainOffers(userId).filter((o) => o.coin.coinId !== coinId));
}

/** Add a shared network to this account's wallet. */
export async function acceptChainOffer(userId: string, coinId: string): Promise<DeployedCoin | null> {
  const offer = listChainOffers(userId).find((o) => o.coin.coinId === coinId);
  if (!offer) return null;
  const { get, put } = await import("../store");
  const existing = await get<DeployedCoin>("deployedCoins", coinId);
  const coin: DeployedCoin = existing ?? {
    ...offer.coin,
    totalSupply: 0,
    deploymentTxId: "",
    status: "active",
    lockedLiquidity: 0,
  };
  if (!existing) await put("deployedCoins", { ...coin, id: coin.coinId });
  dismissChainOffer(userId, coinId);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("coin-deployed", { detail: coin }));
  return coin;
}

/**
 * Keep a verified offer for `userId`. True when it's new (and worth a
 * notification): not their own coin, not already in their wallet, not
 * already waiting.
 */
export async function receiveCoinShare(userId: string, msg: unknown, now = Date.now()): Promise<ChainOffer | null> {
  const share = await verifyCoinShare(msg, now);
  if (!share || share.coin.deployerUserId === userId) return null;
  const { get } = await import("../store");
  if (await get<DeployedCoin>("deployedCoins", share.coin.coinId).catch(() => null)) return null;
  const offers = listChainOffers(userId);
  if (offers.some((o) => o.coin.coinId === share.coin.coinId)) return null;
  const offer: ChainOffer = { coin: share.coin, sharerName: share.sharerName, receivedAt: now };
  saveOffers(userId, [...offers, offer]);
  return offer;
}

// ── Mesh wiring ──────────────────────────────────────────────────────

let transport: ShareTransport | null = null;
let getUserId: () => string | null = () => null;
let detach: (() => void) | null = null;

export function startCoinChainShare(opts: { transport: ShareTransport; getActiveUserId: () => string | null }): () => void {
  detach?.();
  transport = opts.transport;
  getUserId = opts.getActiveUserId;
  const unsub = transport.onMessage(COIN_SHARE_CHANNEL, (_peerId, payload) => {
    const userId = getUserId();
    if (!userId) return;
    void receiveCoinShare(userId, payload).then(async (offer) => {
      if (!offer) return;
      const { notifySystem } = await import("../notifications");
      await notifySystem({
        userId,
        type: "system",
        title: `${offer.sharerName || "A peer"} shared the ${offer.coin.ticker} chain`,
        content: `${offer.coin.chainName} (${offer.coin.ticker}): ${offer.coin.projectGoal}`,
        link: "/wallet?tab=coins",
        linkLabel: "Add to wallet",
        triggeredBy: offer.coin.deployerUserId,
        triggeredByName: offer.sharerName || "Peer",
      });
    }).catch(() => { /* bad share: dropped */ });
  });
  detach = () => { unsub(); transport = null; detach = null; };
  return detach;
}

/** Send the deployer's coin to every connected peer. Returns how many peers it went to. */
export async function shareMyChain(coin: DeployedCoin): Promise<number> {
  if (!transport) throw new Error("The mesh isn't running yet");
  const peers = transport.getConnectedPeerIds();
  if (peers.length === 0) return 0;
  const { getCurrentUser } = await import("@/lib/auth");
  const { getLocalRosterSigner } = await import("./cellChain/cellChains");
  const signer = await getLocalRosterSigner();
  if (!signer) throw new Error("Unlock your wallet to share your chain");
  const me = getCurrentUser();
  const msg = await signCoinShare(coin, me?.displayName || me?.username || "", signer);
  let sent = 0;
  for (const peerId of peers) {
    try { if (await transport.send(COIN_SHARE_CHANNEL, peerId, msg)) sent++; } catch { /* peer gone */ }
  }
  return sent;
}

/** Attach Share my Chain to the standalone Swarm Mesh. Idempotent; boot (main.tsx) calls it. */
export async function attachCoinChainShareToMesh(): Promise<void> {
  if (transport) return;
  const [{ getSwarmMeshStandalone }, { getCurrentUser }, { isGuestUser }] = await Promise.all([
    import("../p2p/swarmMesh.standalone"),
    import("../auth"),
    import("../preview/guestAccess"),
  ]);
  startCoinChainShare({
    transport: getSwarmMeshStandalone(),
    getActiveUserId: () => {
      const me = getCurrentUser();
      return me && !isGuestUser(me) ? me.id : null;
    },
  });
}
