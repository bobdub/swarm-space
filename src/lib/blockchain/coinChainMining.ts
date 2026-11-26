/**
 * Mining a deployed coin.
 *
 * A deployed coin's chain runs on the cell chain engine: the deployer signs
 * a genesis for it (chain id from that genesis, ticker fixed to the coin's
 * ticker) and is the only member on its roster, so the deployer is the only
 * miner. Blocks follow the shared chain's rules (proof of work, 30-second
 * beats, 95/5 reward split, 20-block maturity). Mining a coin never creates
 * SWARM.
 *
 * The "Start Mining my coin" switch on Wallet > Chain is the single gate: it
 * is saved per account and the session follows it for the life of the app.
 */
import { getSessionSnapshot, subscribeSession } from "@/lib/session/sessionStore";
import type { DeployedCoin } from "./types";
import type { CellChain } from "./cellChain/cellChain";
import { getCellChains, getLocalRosterSigner, type CellChains } from "./cellChain/cellChains";
import type { CellSession } from "./cellChain/cellSync";
import { MAX_CELL_NAME_LENGTH, signRosterRecord, type RosterRecord, type TextSigner } from "./cellChain/roster";

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
  mining: boolean;
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
  };
}

// ── The session ──────────────────────────────────────────────────────

let session: CellSession | null = null;
let syncing: Promise<void> = Promise.resolve();
let attached = false;

async function syncNow(): Promise<void> {
  const user = getSessionSnapshot().user;
  const coinId = user ? getCoinMiningPreference(user.id) : null;
  const cellId = coinId ? coinChainCellId(coinId) : null;
  if (session && session.cellId === cellId) return;
  session?.stop();
  session = null;
  if (!user || !coinId || !cellId) return;

  const { getCoin } = await import("./coinDeployment");
  const coin = await getCoin(coinId);
  if (!coin || coin.deployerUserId !== user.id || coin.status !== "active") return;
  if (!await ensureOwnedCoinChain(coin)) return;

  const [{ builderTransport, getLocalCellSigners }, { CellSession: Session }] = await Promise.all([
    import("./cellChain/cellRuntime"),
    import("./cellChain/cellSync"),
  ]);
  // The preference may have changed while the chain opened.
  if (getCoinMiningPreference(user.id) !== coinId || getSessionSnapshot().user?.id !== user.id) return;
  const { transport } = await builderTransport();
  const next = new Session(cellId, getCellChains(), transport, {
    expectedOwner: user.id,
    signers: getLocalCellSigners,
    miningEnabled: () => getSessionSnapshot().user?.id === user.id && getCoinMiningPreference(user.id) === coinId,
  });
  session = next;
  next.start();
  console.log(`[CoinMining] mining ${coin.ticker} on its own chain`);
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
}

/** True while this device is running a mining session for the coin. */
export function isMiningCoin(coinId: string): boolean {
  return session?.cellId === coinChainCellId(coinId);
}
