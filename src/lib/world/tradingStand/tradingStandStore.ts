/**
 * Trading Stand vaults — ledger-derived state and settlement.
 *
 * A stand vault is keyed by where the stand stands:
 *   • a Brain room (the main Brain, a project hub or a live room), or a
 *     public Cell: stock is kept per room, and SWARM and Credits settle
 *     against the main mesh Market Vault (the community pool and its
 *     Credits reserve), so stand trades move the same vault as the Market;
 *   • a private Cell: the stand vault is its own, with stock, SWARM and
 *     Credits all held at the cell's stand address.
 *
 * Every figure is read from mined blocks of the SWARM ledger, so every peer
 * on the same chain tip sees the same stock and the same prices. Payouts are
 * also checked against this device's unmined entries, so nothing is spent
 * twice before a block carries them (the Market Vault's rule, PR #494).
 *
 * Goods move between the player's material bag (`goods.ts`) and the stand's
 * recorded stock. A goods leg is a `custom_token_transfer` in the `GOOD:<id>`
 * currency between the player and the stand address. Unsupported payment
 * fails closed: the stand settles only in SWARM or Credits.
 */
import type { SwarmBlock, SwarmTransaction } from '@/lib/blockchain/types';
import type { UserCell } from '@/lib/p2p/userCell';
import {
  COMMUNITY_POOL,
  VAULT_CREDITS_CURRENCY,
  assertVaultCanRelease,
  confirmedVaultTotals,
  localVaultTotals,
  sharedMarketVaultState,
  vaultCredits,
  type VaultLedgerSource,
} from '@/lib/blockchain/poolLedger';
import type { MarketVaultState } from '@/lib/blockchain/marketVaultPricing';
import {
  TRADING_GOODS,
  getTradingGood,
  isTradingGood,
  maxBuyQty,
  quoteStandBuy,
  splitStandPayment,
  STAND_FLOOR_SHARE,
  quoteStandSell,
  type StandCurrency,
  type StandQuote,
  type StandVaultState,
  type TradingGood,
} from './pricing';
import { giveGood, heldGood, shortGoodMessage, takeGood } from './goods';

export const STAND_ADDRESS_PREFIX = 'trading-stand:';
export const GOOD_CURRENCY_PREFIX = 'GOOD:';

export const goodCurrency = (good: TradingGood) => `${GOOD_CURRENCY_PREFIX}${good}`;

// ── Scope ────────────────────────────────────────────────────────────

export interface StandScope {
  /** Stable vault key, e.g. "room:global" or "cell:u/abc". */
  key: string;
  /** Ledger address holding this stand vault's stock (and, for private cells, its SWARM and Credits). */
  address: string;
  /** True when SWARM and Credits settle against the main mesh Market Vault. */
  settlesMain: boolean;
  /** Shown in the stand window. */
  label: string;
}

/**
 * The stand vault for a Brain room or Cell. A Cell is private unless it is
 * marked public (`isPublic`); public Cells and every Brain room settle
 * against the main mesh vault.
 */
export function standScopeFor(input: { universeKey?: string; cell?: (Pick<UserCell, 'cellId'> & Partial<Pick<UserCell, 'name' | 'isPublic'>>) | null }): StandScope {
  const cell = input.cell;
  if (cell?.cellId && cell.isPublic !== true) {
    const key = `cell:${cell.cellId}`;
    return { key, address: `${STAND_ADDRESS_PREFIX}${key}`, settlesMain: false, label: `Private Cell vault${cell.name ? ` · ${cell.name}` : ''}` };
  }
  const room = input.universeKey && input.universeKey.length > 0 ? input.universeKey : 'global';
  const key = `room:${room}`;
  return { key, address: `${STAND_ADDRESS_PREFIX}${key}`, settlesMain: true, label: 'Main mesh vault' };
}

/**
 * Every stand keeps its own vault: its stock, SWARM and Credits all sit at
 * `trading-stand:stand:<placementId>`, so what its owner funds is what it
 * trades with. (The room/Cell scopes above are the first stands' shared
 * vaults, kept so their ledger records still read.)
 */
export function standVaultScope(placementId: string, ownerName?: string): StandScope {
  const key = `stand:${placementId}`;
  return { key, address: `${STAND_ADDRESS_PREFIX}${key}`, settlesMain: false, label: ownerName ? `${ownerName}'s stand vault` : 'Stand vault' };
}

/** The vault of the stand being traded at. Without a stand, the room or Cell's shared scope. */
export async function currentStandScope(stand?: { placementId: string; ownerName?: string } | null): Promise<StandScope> {
  if (stand?.placementId) return standVaultScope(stand.placementId, stand.ownerName);
  const [{ getActiveUniverse }, { getActiveUserCell }] = await Promise.all([
    import('@/lib/world/worldPlacementsStore'),
    import('@/lib/p2p/userCell'),
  ]);
  return standScopeFor({ universeKey: getActiveUniverse(), cell: getActiveUserCell() });
}

// ── Ledger folds (pure) ──────────────────────────────────────────────

export interface StandTotals {
  stock: Map<TradingGood, number>;
  /** Credits held at the stand address (private Cells only). */
  credits: number;
  seen: Set<string>;
}

function emptyTotals(): StandTotals {
  return { stock: new Map(), credits: 0, seen: new Set() };
}

function cloneTotals(t: StandTotals): StandTotals {
  return { stock: new Map(t.stock), credits: t.credits, seen: new Set(t.seen) };
}

/** Fold one ledger entry into the totals of the stand at `address`. */
export function stepStandTotals(t: StandTotals, tx: SwarmTransaction, address: string): void {
  if (tx.type !== 'custom_token_transfer' || (tx.from !== address && tx.to !== address)) return;
  if (t.seen.has(tx.id)) return;
  t.seen.add(tx.id);
  const m = (tx.meta ?? {}) as Record<string, unknown>;
  const amount = Number(tx.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const sign = (tx.to === address ? 1 : 0) - (tx.from === address ? 1 : 0);
  if (sign === 0) return;
  if (m.currency === VAULT_CREDITS_CURRENCY) {
    t.credits += sign * amount;
    return;
  }
  if (typeof m.currency === 'string' && m.currency.startsWith(GOOD_CURRENCY_PREFIX)) {
    const good = m.currency.slice(GOOD_CURRENCY_PREFIX.length);
    if (!isTradingGood(good)) return;
    t.stock.set(good, (t.stock.get(good) ?? 0) + sign * Math.floor(amount));
  }
}

export function standTotalsOf(transactions: Iterable<SwarmTransaction>, address: string): StandTotals {
  const t = emptyTotals();
  for (const tx of transactions) stepStandTotals(t, tx, address);
  return t;
}

export function standStock(t: StandTotals): Partial<Record<TradingGood, number>> {
  const out: Partial<Record<TradingGood, number>> = {};
  for (const g of TRADING_GOODS) out[g.id] = Math.max(0, Math.floor(t.stock.get(g.id) ?? 0));
  return out;
}

const confirmedCache = new WeakMap<object, Map<string, { length: number; tipHash: string; totals: StandTotals }>>();

/** Stand totals over mined blocks, resumed from the cached tip like the Market Vault's. Shared: do not change. */
export function confirmedStandTotals(chain: { getChain(): SwarmBlock[] }, address: string): StandTotals {
  const blocks = chain.getChain();
  let perChain = confirmedCache.get(chain);
  if (!perChain) { perChain = new Map(); confirmedCache.set(chain, perChain); }
  const cached = perChain.get(address);
  let start = 0;
  let totals: StandTotals;
  if (cached && blocks.length >= cached.length && cached.length > 0 && blocks[cached.length - 1]?.hash === cached.tipHash) {
    if (blocks.length === cached.length) return cached.totals;
    totals = cloneTotals(cached.totals);
    start = cached.length;
  } else {
    totals = emptyTotals();
  }
  for (let b = start; b < blocks.length; b++) for (const tx of blocks[b].transactions ?? []) stepStandTotals(totals, tx, address);
  const tipHash = blocks[blocks.length - 1]?.hash;
  if (tipHash) perChain.set(address, { length: blocks.length, tipHash, totals });
  return totals;
}

/** Mined totals plus this device's unmined entries. */
export function localStandTotals(chain: { getChain(): SwarmBlock[]; getPendingTransactions(): SwarmTransaction[] }, address: string): StandTotals {
  const t = cloneTotals(confirmedStandTotals(chain, address));
  for (const tx of chain.getPendingTransactions()) stepStandTotals(t, tx, address);
  return t;
}

/**
 * The stand vault every peer on the same chain tip agrees on: prices are
 * quoted from this.
 */
export function sharedStandVaultState(chain: VaultLedgerSource, scope: StandScope): StandVaultState {
  const market = sharedMarketVaultState(chain);
  const totals = confirmedStandTotals(chain, scope.address);
  if (scope.settlesMain) {
    return { swarmPool: market.poolBalance, creditReserve: vaultCredits(confirmedVaultTotals(chain)), stock: standStock(totals), market };
  }
  const swarm = Math.max(0, chain.getConfirmedBalance(scope.address));
  return { swarmPool: round6(swarm), creditReserve: Math.max(0, Math.floor(totals.credits)), stock: standStock(totals), market };
}

/**
 * What this device may pay out or hand over right now: the shared figures,
 * lowered (never raised) by this device's own unmined stand trades.
 */
export function spendableStandVaultState(chain: VaultLedgerSource, scope: StandScope): StandVaultState {
  const shared = sharedStandVaultState(chain, scope);
  const local = localStandTotals(chain, scope.address);
  const stock: Partial<Record<TradingGood, number>> = {};
  const localStock = standStock(local);
  for (const g of TRADING_GOODS) stock[g.id] = Math.min(shared.stock[g.id] ?? 0, localStock[g.id] ?? 0);
  if (scope.settlesMain) {
    const credits = Math.min(shared.creditReserve, vaultCredits(localVaultTotals(chain)));
    return { ...shared, creditReserve: credits, stock };
  }
  return {
    ...shared,
    swarmPool: round6(Math.min(shared.swarmPool, Math.max(0, chain.getBalance(scope.address)))),
    creditReserve: Math.min(shared.creditReserve, Math.max(0, Math.floor(local.credits))),
    stock,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ── Reads ────────────────────────────────────────────────────────────

async function readyChain() {
  const { getSwarmChain } = await import('@/lib/blockchain/chain');
  const chain = getSwarmChain();
  await chain.whenReady();
  return chain;
}

export async function getStandVaultState(scope: StandScope): Promise<StandVaultState> {
  return sharedStandVaultState(await readyChain(), scope);
}

/**
 * Stock as this device's ledger holds it: mined blocks plus this device's
 * own unmined stand entries. A sale is on the chain from the moment it is
 * made (it waits in pending, persisted, until a block takes it), so the
 * stand shows it straight away and after a refresh; prices are still
 * quoted from the mined figures every peer shares.
 */
export function localStandStock(chain: VaultLedgerSource, scope: StandScope): Partial<Record<TradingGood, number>> {
  return standStock(localStandTotals(chain, scope.address));
}

export async function getStandLocalStock(scope: StandScope): Promise<Partial<Record<TradingGood, number>>> {
  return localStandStock(await readyChain(), scope);
}

export const TRADING_STAND_EVENT = 'trading-stand-update';

function announce(scope: StandScope, tx?: SwarmTransaction) {
  if (typeof window === 'undefined') return;
  if (tx) window.dispatchEvent(new CustomEvent('blockchain-transaction', { detail: tx }));
  window.dispatchEvent(new CustomEvent(TRADING_STAND_EVENT, { detail: { key: scope.key } }));
}

// ── Settlement ───────────────────────────────────────────────────────

export interface StandTradeRequest {
  userId: string;
  scope: StandScope;
  good: TradingGood;
  qty: number;
  currency: StandCurrency;
  /** The stand being traded at, so its owner takes their 15% of sales. */
  stand?: { placementId: string; ownerId: string } | null;
}

/** Trades settle only against a stand's own vault (`standVaultScope`). */
function assertOwnVault(scope: StandScope) {
  if (scope.settlesMain) throw new Error('Trade at a placed Trading Stand: each stand is its own market. Nothing was charged.');
}

function assertSupported(currency: string): asserts currency is StandCurrency {
  if (currency !== 'SWARM' && currency !== 'CREDITS') {
    throw new Error('The Trading Stand settles only in SWARM or Credits. Nothing was charged.');
  }
}

async function assertSignedIn(userId: string) {
  const { getCurrentUser } = await import('@/lib/auth');
  if (!userId || getCurrentUser()?.id !== userId) throw new Error('Sign in to trade at the stand.');
}

function lockFor(scope: StandScope) {
  // Main-vault trades share the Market Vault's lock, so a stand trade and a
  // Market trade can never spend the same pool at once.
  return scope.settlesMain ? 'swarm-market-vault' : `trading-stand:${scope.key}`;
}

async function addRecord(params: {
  from: string;
  to: string;
  amount: number;
  currency: string;
  meta: Record<string, unknown>;
}): Promise<SwarmTransaction> {
  const { generateTransactionId } = await import('@/lib/blockchain/crypto');
  const chain = await readyChain();
  const tx: SwarmTransaction = {
    id: generateTransactionId(), type: 'custom_token_transfer', from: params.from, to: params.to, amount: params.amount,
    timestamp: new Date().toISOString(), signature: '', publicKey: params.from, nonce: Date.now(), fee: 0,
    meta: { currency: params.currency, ...params.meta },
  };
  chain.addTransaction(tx);
  return tx;
}

/** Player buys goods from the stand, paying SWARM or Credits. */
export async function buyFromStand(req: StandTradeRequest): Promise<StandQuote> {
  assertOwnVault(req.scope);
  assertSupported(req.currency);
  if (!getTradingGood(req.good)) throw new Error('The stand does not trade this good.');
  const { withCreatorMarketOperation } = await import('@/lib/blockchain/creatorMarketOperation');
  return withCreatorMarketOperation(lockFor(req.scope), async () => {
    await assertSignedIn(req.userId);
    const chain = await readyChain();
    const shared = sharedStandVaultState(chain, req.scope);
    const spendable = spendableStandVaultState(chain, req.scope);
    const balance = await payerBalance(req.userId, req.currency);
    const quote = quoteStandBuy(shared, req.good, req.qty, req.currency, balance);
    if (quote.error) throw new Error(quote.error);
    // The stock handed over must still be there after this device's unmined trades.
    if (req.qty > maxBuyQty(spendable.stock[req.good] ?? 0)) {
      throw new Error('That stock is promised to trades still waiting for a block. Nothing was charged.');
    }
    const operationId = crypto.randomUUID();
    const standMeta = req.stand ? { standId: req.stand.placementId, standOwner: req.stand.ownerId } : {};
    const meta = { tradingStand: true, standKey: req.scope.key, direction: 'stand-buy', operationId, good: req.good, goodQty: req.qty, ...standMeta };
    const vaultAddress = req.scope.settlesMain ? COMMUNITY_POOL : req.scope.address;
    // A stand is its own market: each sale splits like a creator market buy,
    // 15% to the stand's owner, 5% to the community pool and 80% (buyback and
    // stability) into the stand's own vault. Owner and community legs go
    // first, so if one fails the vault leg has not moved. The owner buying at
    // their own stand pays the full price and the vault pays their 15% back.
    const split = splitStandPayment(quote.amount, req.currency, req.stand?.ownerId);
    const ownerBuys = !!req.stand && req.stand.ownerId === req.userId;
    const toVault = ownerBuys ? split.vault + split.owner : split.vault;
    let payment: SwarmTransaction;
    let refund: SwarmTransaction | undefined;
    if (req.currency === 'SWARM') {
      const { transferSwarm } = await import('@/lib/blockchain/token');
      if (split.owner > 0 && req.stand && !ownerBuys) {
        await transferSwarm({ from: req.userId, to: req.stand.ownerId, amount: split.owner, meta: { ...meta, tradeLeg: 'owner-cut' } });
      }
      if (split.community > 0) {
        // Counted as pool inflow the way a Market sale's SWARM is (poolLedger).
        await transferSwarm({ from: req.userId, to: COMMUNITY_POOL, amount: split.community,
          meta: { ...meta, tradeLeg: 'community', marketVault: true, direction: 'vault-sell' } });
      }
      payment = await transferSwarm({ from: req.userId, to: vaultAddress, amount: round6(toVault), meta: { ...meta, tradeLeg: 'payment' } });
      if (ownerBuys && split.owner > 0) {
        refund = await transferSwarm({ from: vaultAddress, to: req.userId, amount: split.owner, meta: { ...meta, tradeLeg: 'owner-cut' } });
      }
    } else {
      const { awardVaultCredits, deductCredits, transferCredits } = await import('@/lib/credits');
      if (split.owner > 0 && req.stand && !ownerBuys) {
        await transferCredits(req.stand.ownerId, split.owner, { message: `Trading Stand sale: ${req.qty} ${req.good}` });
        // The Credits move off-chain; this records the owner's 15% on the chain too.
        await addRecord({ from: req.userId, to: req.stand.ownerId, amount: split.owner, currency: VAULT_CREDITS_CURRENCY,
          meta: { ...meta, tradeLeg: 'owner-cut' } });
      }
      await deductCredits(req.userId, toVault + split.community, `Trading Stand: ${req.qty} ${req.good} for ${quote.credits} credits`);
      if (split.community > 0) {
        // The community share of Credits joins the Market Vault's Credits reserve.
        await addRecord({ from: req.userId, to: COMMUNITY_POOL, amount: split.community, currency: VAULT_CREDITS_CURRENCY,
          meta: { ...meta, tradeLeg: 'community', marketVault: true } });
      }
      payment = await addRecord({ from: req.userId, to: vaultAddress, amount: toVault, currency: VAULT_CREDITS_CURRENCY,
        meta: { ...meta, tradeLeg: 'payment', ownerCut: split.owner, communityCut: split.community } });
      if (ownerBuys && split.owner > 0) {
        refund = await addRecord({ from: vaultAddress, to: req.userId, amount: split.owner, currency: VAULT_CREDITS_CURRENCY, meta: { ...meta, tradeLeg: 'owner-cut' } });
        await awardVaultCredits(req.userId, split.owner, 'Trading Stand: your 15% of a sale at your stand');
      }
    }
    const goods = await addRecord({ from: req.scope.address, to: req.userId, amount: req.qty, currency: goodCurrency(req.good),
      meta: { ...meta, tradeLeg: 'goods', paidAmount: quote.amount, paidAsset: req.currency } });
    giveGood(req.good, req.qty);
    if (req.scope.settlesMain) {
      const { derivePoolFromChain } = await import('@/lib/blockchain/storage');
      await derivePoolFromChain().catch(() => {});
    }
    announce(req.scope, payment);
    if (refund) announce(req.scope, refund);
    announce(req.scope, goods);
    return quote;
  });
}

/** Player sells goods to the stand for SWARM or Credits. */
export async function sellToStand(req: StandTradeRequest): Promise<StandQuote> {
  assertOwnVault(req.scope);
  assertSupported(req.currency);
  if (!getTradingGood(req.good)) throw new Error('The stand does not trade this good.');
  const { withCreatorMarketOperation } = await import('@/lib/blockchain/creatorMarketOperation');
  return withCreatorMarketOperation(lockFor(req.scope), async () => {
    await assertSignedIn(req.userId);
    const chain = await readyChain();
    const shared = sharedStandVaultState(chain, req.scope);
    const spendable = spendableStandVaultState(chain, req.scope);
    const quote = quoteStandSell(shared, req.good, req.qty, req.currency, heldGood(req.good));
    if (quote.error) throw new Error(quote.error);
    // Payouts come from what this device can still release above the floor.
    if (req.currency === 'SWARM') {
      if (req.scope.settlesMain) assertVaultCanRelease(chain, shared.market as MarketVaultState, quote.swarm);
      else if (quote.swarm > spendable.swarmPool - shared.swarmPool * STAND_FLOOR_SHARE + 1e-9) {
        throw new Error('The stand vault can pay less from this device until your earlier trades are mined. Nothing was taken.');
      }
    } else if (quote.credits > spendable.creditReserve - Math.ceil(shared.creditReserve * STAND_FLOOR_SHARE)) {
      throw new Error('The stand vault can pay fewer Credits from this device until your earlier trades are mined. Nothing was taken.');
    }
    if (!takeGood(req.good, req.qty)) throw new Error(shortGoodMessage(req.good, req.qty));
    const operationId = crypto.randomUUID();
    const meta = { tradingStand: true, standKey: req.scope.key, direction: 'stand-sell', operationId, good: req.good, goodQty: req.qty };
    let payout: SwarmTransaction | undefined;
    try {
      if (req.currency === 'SWARM') {
        if (req.scope.settlesMain) {
          const { releaseMinedPoolSwarm } = await import('@/lib/blockchain/creditWrapping');
          const payoutId = `${operationId}:payout`;
          await releaseMinedPoolSwarm({ to: req.userId, amount: quote.swarm, creditsLocked: 0, transactionId: payoutId,
            reason: `Trading Stand: sold ${req.qty} ${req.good} for ${quote.swarm} SWARM`,
            meta: { ...meta, marketVault: true, tradeLeg: 'payout', paidAmount: req.qty, paidAsset: req.good, receivedAsset: 'SWARM' } });
        } else {
          const { transferSwarm } = await import('@/lib/blockchain/token');
          payout = await transferSwarm({ from: req.scope.address, to: req.userId, amount: quote.swarm,
            meta: { ...meta, tradeLeg: 'payout', paidAmount: req.qty, paidAsset: req.good, receivedAsset: 'SWARM' } });
        }
      } else {
        payout = await addRecord({ from: req.scope.settlesMain ? COMMUNITY_POOL : req.scope.address, to: req.userId, amount: quote.credits,
          currency: VAULT_CREDITS_CURRENCY,
          meta: { ...meta, tradeLeg: 'payout', paidAmount: req.qty, paidAsset: req.good, receivedAsset: 'Credits', ...(req.scope.settlesMain ? { marketVault: true } : {}) } });
        const { awardVaultCredits } = await import('@/lib/credits');
        await awardVaultCredits(req.userId, quote.credits, `Trading Stand: sold ${req.qty} ${req.good} for ${quote.credits} credits`);
      }
    } catch (error) {
      // Nothing was paid, so the goods go back in the bag.
      const paidOut = chain.hasTransaction(`${operationId}:payout`) || (payout && chain.hasTransaction(payout.id));
      if (!paidOut) giveGood(req.good, req.qty);
      throw error;
    }
    const goods = await addRecord({ from: req.userId, to: req.scope.address, amount: req.qty, currency: goodCurrency(req.good),
      meta: { ...meta, tradeLeg: 'goods' } });
    if (req.scope.settlesMain) {
      const { derivePoolFromChain } = await import('@/lib/blockchain/storage');
      await derivePoolFromChain().catch(() => {});
    }
    announce(req.scope, payout);
    announce(req.scope, goods);
    return quote;
  });
}

/** Stock a stand with goods for nothing back, so a new private stand has something to sell. */
export async function donateGoodsToStand(
  userId: string,
  scope: StandScope,
  stand: { placementId: string; ownerId: string } | null | undefined,
  good: TradingGood,
  qty: number,
): Promise<void> {
  // Only a stand's owner stocks it, and only into that stand's own vault.
  if (!stand || stand.ownerId !== userId) throw new Error('Only the stand\'s owner can stock it.');
  if (scope.settlesMain || scope.key !== standVaultScope(stand.placementId).key) throw new Error('Stock a stand from that stand.');
  if (!getTradingGood(good)) throw new Error('The stand does not trade this good.');
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error('Enter a whole number of units.');
  const { withCreatorMarketOperation } = await import('@/lib/blockchain/creatorMarketOperation');
  await withCreatorMarketOperation(lockFor(scope), async () => {
    await assertSignedIn(userId);
    if (!takeGood(good, qty)) throw new Error(shortGoodMessage(good, qty));
    try {
      const tx = await addRecord({ from: userId, to: scope.address, amount: qty, currency: goodCurrency(good),
        meta: { tradingStand: true, standKey: scope.key, standId: stand.placementId, direction: 'donation', operationId: crypto.randomUUID(), tradeLeg: 'goods' } });
      announce(scope, tx);
    } catch (error) {
      giveGood(good, qty);
      throw error;
    }
  });
}

async function payerBalance(userId: string, currency: StandCurrency): Promise<number> {
  if (currency === 'SWARM') {
    const { getSwarmBalance } = await import('@/lib/blockchain/token');
    return getSwarmBalance(userId);
  }
  const { getCreditBalance } = await import('@/lib/credits');
  return getCreditBalance(userId);
}

export async function getPlayerBalances(userId: string): Promise<{ swarm: number; credits: number }> {
  const [swarm, credits] = await Promise.all([payerBalance(userId, 'SWARM').catch(() => 0), payerBalance(userId, 'CREDITS').catch(() => 0)]);
  return { swarm, credits };
}

// ── Owner funding ────────────────────────────────────────────────────

export type StandDonationAsset =
  | { kind: 'SWARM' }
  | { kind: 'CREDITS' }
  | { kind: 'TOKEN'; contract: string; symbol?: string };

/**
 * The stand's owner adds their own SWARM, Credits or synced tokens to the
 * stand's own vault, never the main Market Vault. Anything else fails closed.
 */
export async function donateToStandVault(
  userId: string,
  scope: StandScope,
  stand: { placementId: string; ownerId: string },
  asset: StandDonationAsset,
  amount: number,
): Promise<void> {
  if (stand.ownerId !== userId) throw new Error('Only the stand\'s owner can fund it.');
  if (scope.settlesMain) throw new Error('This stand has no vault of its own to fund.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount above zero.');
  const { withCreatorMarketOperation } = await import('@/lib/blockchain/creatorMarketOperation');
  await withCreatorMarketOperation(lockFor(scope), async () => {
    await assertSignedIn(userId);
    const meta = { tradingStand: true, standKey: scope.key, standId: stand.placementId, direction: 'donation', operationId: crypto.randomUUID() };
    let tx: SwarmTransaction;
    if (asset.kind === 'SWARM') {
      const { transferSwarm } = await import('@/lib/blockchain/token');
      tx = await transferSwarm({ from: userId, to: scope.address, amount: Math.round(amount * 1e6) / 1e6, meta });
    } else if (asset.kind === 'CREDITS') {
      if (!Number.isSafeInteger(amount)) throw new Error('Credits are donated in whole numbers.');
      const { deductCredits } = await import('@/lib/credits');
      await deductCredits(userId, amount, `Trading Stand: funded your stand with ${amount} credits`);
      tx = await addRecord({ from: userId, to: scope.address, amount, currency: VAULT_CREDITS_CURRENCY, meta });
    } else if (asset.kind === 'TOKEN') {
      const c = asset.contract.toLowerCase();
      const { getAvailableTokenBalance, tokenCurrency } = await import('@/lib/blockchain/deposits/customTokens');
      if (amount > getAvailableTokenBalance(userId, c) + 1e-9) throw new Error('More than your available (synced) balance.');
      tx = await addRecord({ from: userId, to: scope.address, amount: Math.round(amount * 1e8) / 1e8, currency: tokenCurrency(c),
        meta: { ...meta, ...(asset.symbol ? { ticker: asset.symbol } : {}) } });
    } else {
      throw new Error('This asset cannot be added to a stand vault. Nothing was moved.');
    }
    announce(scope, tx);
  });
}
