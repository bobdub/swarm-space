/**
 * Mining a deployed coin.
 *
 * A deployed coin's chain runs on the cell chain engine: the deployer signs
 * a genesis for it (chain id from that genesis, ticker fixed to the coin's
 * ticker) and owns its roster. Peers who added the chain can switch to it
 * and help mine: their device asks over the mesh, the deployer's device
 * (while it mines) signs an invite, and the helper's session accepts it, so
 * every miner is on the signed roster. Blocks follow the shared chain's rules (proof of work, 30-second
 * beats, 95/5 reward split, 20-block maturity). Mining a coin never creates
 * SWARM.
 *
 * Nobody mines alone: like SWARM, a coin is mined only while the deployer's
 * node is online on the SWARM Mesh with at least one other person (a member
 * or a guest) connected. The "Start Mining my coin" switch on Wallet > Chain
 * turns it on; it is saved per account and the session follows it for the
 * life of the app.
 */
import { getSessionSnapshot, subscribeSession } from "@/lib/session/sessionStore";
import type { DeployedCoin } from "./types";
import type { CellChain } from "./cellChain/cellChain";
import { getCellChains, getLocalRosterSigner, type CellChains } from "./cellChain/cellChains";
import type { CellSession, CellTransport } from "./cellChain/cellSync";
import { base64ToArrayBuffer, computeUserId } from "@/lib/crypto";
import { canonical, MAX_CELL_MEMBERS, MAX_CELL_NAME_LENGTH, signRosterRecord, type RosterRecord, type SignedRosterRecord, type TextSigner } from "./cellChain/roster";

const PREF_PREFIX = "coin-mining-v1:";
export const COIN_MINING_EVENT = "coin-mining-changed";

/** The cell id a deployed coin's chain is kept under (never collides with a real cell id). */
export function coinChainCellId(coinId: string): string {
  return `coin:${coinId}`;
}

// ── The switch ───────────────────────────────────────────────────────

/** The coin this account mines, or null when the switch is off. */
export function getCoinMiningPreference(userId: string): string | null {
  try { return localStorage.getItem(PREF_PREFIX + userId) || null; } catch { return null; }
}

export function setCoinMiningPreference(userId: string, coinId: string | null): void {
  try {
    if (coinId) localStorage.setItem(PREF_PREFIX + userId, coinId);
    else localStorage.removeItem(PREF_PREFIX + userId);
  } catch { /* storage blocked: the switch stays off */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(COIN_MINING_EVENT, { detail: { userId, coinId } }));
  }
}

// ── Who's with you ───────────────────────────────────────────────────

/** Members and guests connected to this node on the SWARM Mesh right now (0 when offline). */
export function connectedCompanions(): number {
  try {
    const mesh = meshRef;
    if (!mesh || mesh.getPhase() !== "online") return 0;
    return mesh.getConnectedPeerIds().length;
  } catch {
    return 0;
  }
}

/** The mining rule: switch on, and at least one other person connected. */
export function coinMiningAllowed(switchOn: boolean, companions: number): boolean {
  return switchOn && companions >= 1;
}

type MeshView = { getPhase(): string; getConnectedPeerIds(): string[] };
let meshRef: MeshView | null = null;

// ── The chain ────────────────────────────────────────────────────────

/** Open a coin's chain on this device. Null when it has no genesis here yet. */
export function openCoinChain(coinId: string): Promise<CellChain | null> {
  return getCellChains().chain(coinChainCellId(coinId));
}

/**
 * Deployer's device: make sure the coin has its signed genesis and chain.
 * Null when the vault is locked or the signed-in account isn't the deployer.
 */
export async function ensureOwnedCoinChain(
  coin: DeployedCoin,
  chains: CellChains = getCellChains(),
  localSigner?: TextSigner,
): Promise<CellChain | null> {
  const cellId = coinChainCellId(coin.coinId);
  const existing = chains.genesis(cellId);
  if (existing) return existing.record.kind === "genesis" && existing.record.owner === coin.deployerUserId ? chains.chain(cellId) : null;
  const signer = localSigner ?? await getLocalRosterSigner();
  if (!signer || signer.userId !== coin.deployerUserId) return null;
  const record: RosterRecord = {
    kind: "genesis",
    cellId,
    name: coin.chainName.slice(0, MAX_CELL_NAME_LENGTH),
    ticker: coin.ticker,
    owner: signer.userId,
    at: Date.now(),
  };
  const genesis = await signRosterRecord(record, signer);
  if (!await chains.setGenesis(cellId, genesis)) return null;
  return chains.chain(cellId);
}

export interface CoinChainStats {
  height: number;
  balance: number;
  maturing: number;
  supply: number;
  /** The session is running (switch on). */
  mining: boolean;
  /** Members or guests connected now; blocks are only mined while this is at least 1. */
  companions: number;
}

/** What the deployer's wallet shows for their coin's chain. Null before its first genesis. */
export async function getCoinChainStats(coinId: string, userId: string): Promise<CoinChainStats | null> {
  const chain = await openCoinChain(coinId).catch(() => null);
  if (!chain) return null;
  return {
    height: chain.getLatestBlock().index,
    balance: chain.getBalance(userId),
    maturing: chain.getImmatureRewards(userId),
    supply: chain.getTotalSupply(),
    mining: session?.cellId === coinChainCellId(coinId),
    companions: connectedCompanions(),
  };
}

// ── The session ──────────────────────────────────────────────────────

/** Coin chain sessions run over the SWARM Mesh, where the peers who add a shared chain already are. */
export const COIN_CHAIN_CHANNEL = "coin-chain";
/** Helpers ask the deployer to put them on the roster over this channel. */
export const COIN_JOIN_CHANNEL = "coin-chain-join";
const JOIN_RETRY_MS = 30_000;

let session: CellSession | null = null;
let sessionCoin: DeployedCoin | null = null;
let joinTimer: ReturnType<typeof setInterval> | null = null;
let syncing: Promise<void> = Promise.resolve();
let attached = false;

type Mesh = MeshView & {
  getPeerId(): string;
  send(channel: string, peerId: string, payload: unknown): Promise<boolean>;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
  onPeersChange(handler: () => void): () => void;
};

function meshTransport(mesh: Mesh): CellTransport {
  return {
    selfPeerId: () => mesh.getPeerId(),
    peers: () => mesh.getConnectedPeerIds(),
    send: (peerId, payload) => { void mesh.send(COIN_CHAIN_CHANNEL, peerId, payload); },
    onMessage: (handler) => mesh.onMessage(COIN_CHAIN_CHANNEL, handler),
    onPeersChange: (handler) => mesh.onPeersChange(() => handler(mesh.getConnectedPeerIds())),
  };
}

// ── Joining as a helper ──────────────────────────────────────────────

export interface CoinJoinRequest {
  t: "join";
  v: 1;
  coinId: string;
  userId: string;
  at: number;
  publicKey: string;
  signature: string;
}

function joinText(coinId: string, userId: string, at: number, publicKey: string): string {
  return canonical({ v: 1, type: "coin-chain-join", coinId, userId, at, publicKey });
}

export async function signCoinJoin(coinId: string, signer: TextSigner, at = Date.now()): Promise<CoinJoinRequest> {
  const signature = await signer.signText(joinText(coinId, signer.userId, at, signer.publicKey));
  return { t: "join", v: 1, coinId, userId: signer.userId, at, publicKey: signer.publicKey, signature };
}

/** The request, when it's signed by the account it names and fresh (within 5 minutes either way). */
export async function verifyCoinJoin(msg: unknown, now = Date.now()): Promise<CoinJoinRequest | null> {
  const m = msg as CoinJoinRequest | null;
  if (!m || m.t !== "join" || m.v !== 1 || typeof m.coinId !== "string" || m.coinId.length > 128) return null;
  if (typeof m.userId !== "string" || typeof m.publicKey !== "string" || typeof m.signature !== "string") return null;
  if (!Number.isSafeInteger(m.at) || Math.abs(m.at - now) > 5 * 60 * 1000) return null;
  try {
    if (await computeUserId(m.publicKey) !== m.userId) return null;
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(m.publicKey),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      base64ToArrayBuffer(m.signature), new TextEncoder().encode(joinText(m.coinId, m.userId, m.at, m.publicKey)));
    return ok ? m : null;
  } catch {
    return null;
  }
}

/**
 * Deployer's device: put a helper on the coin's roster (an invite their
 * session accepts on arrival). Only while the deployer is mining the coin,
 * so nobody is invited to a chain that isn't running.
 */
export async function admitHelper(
  coin: DeployedCoin,
  request: CoinJoinRequest,
  chains: CellChains = getCellChains(),
  localSigner?: TextSigner,
): Promise<SignedRosterRecord | null> {
  if (request.coinId !== coin.coinId || request.userId === coin.deployerUserId) return null;
  const cellId = coinChainCellId(coin.coinId);
  const chain = await chains.chain(cellId);
  if (!chain) return null;
  const roster = chain.getRoster();
  if (roster.owner !== coin.deployerUserId || roster.isMember(request.userId) || roster.hasOpenInvite(request.userId)) return null;
  if (roster.members.size >= MAX_CELL_MEMBERS) return null;
  const queued = chain.getPendingTransactions().some((tx) => {
    const r = (tx.meta?.roster as SignedRosterRecord | undefined)?.record;
    return r?.kind === "invite" && r.invitee === request.userId;
  });
  if (queued) return null;
  const signer = localSigner ?? await getLocalRosterSigner();
  if (!signer || signer.userId !== coin.deployerUserId) return null;
  return chains.invite(cellId, request.userId, signer);
}

async function handleJoin(payload: unknown): Promise<void> {
  const coin = sessionCoin;
  const running = session;
  const me = getSessionSnapshot().user?.id;
  if (!coin || !running || !me || coin.deployerUserId !== me) return;
  const request = await verifyCoinJoin(payload);
  if (!request) return;
  const invite = await admitHelper(coin, request);
  if (!invite) return;
  const chain = await openCoinChain(coin.coinId);
  const tx = chain?.getPendingTransactions().find((p) => (p.meta?.roster as SignedRosterRecord | undefined)?.signature === invite.signature);
  if (tx) await running.announce(tx);
  console.log(`[CoinMining] ${request.userId.slice(0, 12)} joined ${coin.ticker} as a helper`);
}

/** Helper's device: ask the connected peers (the deployer among them) to be put on the roster, until we're on it. */
async function askToJoin(mesh: Mesh, coin: DeployedCoin): Promise<void> {
  const signer = await getLocalRosterSigner();
  if (!signer || signer.userId === coin.deployerUserId) return;
  const chain = await openCoinChain(coin.coinId).catch(() => null);
  if (chain?.getRoster().isMember(signer.userId)) return;
  const request = await signCoinJoin(coin.coinId, signer);
  for (const peerId of mesh.getConnectedPeerIds()) void mesh.send(COIN_JOIN_CHANNEL, peerId, request);
}

function stopSession(): void {
  session?.stop();
  session = null;
  sessionCoin = null;
  if (joinTimer) clearInterval(joinTimer);
  joinTimer = null;
}

async function syncNow(): Promise<void> {
  const user = getSessionSnapshot().user;
  const coinId = user ? getCoinMiningPreference(user.id) : null;
  const cellId = coinId ? coinChainCellId(coinId) : null;
  if (session && session.cellId === cellId) return;
  stopSession();
  if (!user || !coinId || !cellId) return;

  const { getCoin } = await import("./coinDeployment");
  const coin = await getCoin(coinId);
  if (!coin || coin.status !== "active") return;
  const own = coin.deployerUserId === user.id;
  // The deployer signs the genesis; a helper receives it from the deployer once admitted.
  if (own && !await ensureOwnedCoinChain(coin)) return;

  const [{ getLocalCellSigners }, { CellSession: Session }, { getSwarmMeshStandalone }] = await Promise.all([
    import("./cellChain/cellRuntime"),
    import("./cellChain/cellSync"),
    import("../p2p/swarmMesh.standalone"),
  ]);
  // The preference may have changed while the chain opened.
  if (getCoinMiningPreference(user.id) !== coinId || getSessionSnapshot().user?.id !== user.id) return;
  const mesh = getSwarmMeshStandalone() as unknown as Mesh;
  meshRef = mesh;
  attachJoinListener(mesh);
  const next = new Session(cellId, getCellChains(), meshTransport(mesh), {
    expectedOwner: coin.deployerUserId,
    signers: getLocalCellSigners,
    miningEnabled: () => coinMiningAllowed(
      getSessionSnapshot().user?.id === user.id && getCoinMiningPreference(user.id) === coinId,
      connectedCompanions(),
    ),
  });
  session = next;
  sessionCoin = coin;
  next.start();
  if (!own) {
    void askToJoin(mesh, coin);
    joinTimer = setInterval(() => { void askToJoin(mesh, coin); }, JOIN_RETRY_MS);
  }
  console.log(`[CoinMining] ${own ? "mining" : "helping mine"} ${coin.ticker} on its own chain`);
}

let joinDetach: (() => void) | null = null;
function attachJoinListener(mesh: Mesh): void {
  if (joinDetach) return;
  joinDetach = mesh.onMessage(COIN_JOIN_CHANNEL, (_peerId, payload) => {
    void handleJoin(payload).catch((err) => console.warn("[CoinMining] join failed", err));
  });
}

/** Start or stop the session to match the signed-in account's switch. */
export function syncCoinMining(): Promise<void> {
  syncing = syncing
    .then(syncNow)
    .catch((err) => console.warn("[CoinMining] session failed", err));
  return syncing;
}

/** Follow the switch and the signed-in account for the life of the app. */
export function attachCoinMiningRuntime(): void {
  if (attached || typeof window === "undefined") return;
  attached = true;
  let lastUser: string | null | undefined;
  subscribeSession((snap) => {
    const id = snap.user?.id ?? null;
    if (id === lastUser) return;
    lastUser = id;
    void syncCoinMining();
  });
  window.addEventListener(COIN_MINING_EVENT, () => { void syncCoinMining(); });
  // A locked vault can't sign the coin's genesis: unlocking retries startup.
  window.addEventListener("wallet-lock-changed", () => { void syncCoinMining(); });
}

/** True when the coin has its own mined chain on this device (its balances live there, not on SWARM). */
export function hasCoinChain(coinId: string): boolean {
  return !!getCellChains().genesis(coinChainCellId(coinId));
}

/** True while this device is running a mining session for the coin. */
export function isMiningCoin(coinId: string): boolean {
  return session?.cellId === coinChainCellId(coinId);
}
