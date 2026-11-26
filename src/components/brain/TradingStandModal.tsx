/**
 * TradingStandModal — the trade window of a Trading Stand, and the
 * proximity prompt that opens it.
 *
 * Walking within 3.5 m of a placed stand shows "Trading Stand - Open
 * Bazaar"; tapping it opens the window, which lists each good with live Buy
 * and Sell prices in both SWARM and Credits. Prices and stock come from the
 * stand vault on the SWARM ledger (`tradingStandStore.ts`), so every peer on
 * the same chain tip reads the same board.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Store } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { customTokenRef, getAvailableTokenBalance, listCustomTokens } from '@/lib/blockchain/deposits/customTokens';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { blockWorldPos, getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { TRADING_STAND_ID } from '@/lib/brain/prefabHouseCatalog';
import { listPlacements, subscribePlacements } from '@/lib/world/worldPlacementsStore';
import { subscribeHarvested } from '@/lib/remix/harvestedInventory';
import { nearestStandWithin, STAND_TITLE, type StandPoint } from '@/lib/world/tradingStand/proximity';
import {
  TRADING_GOODS,
  quoteStandBuy,
  quoteStandSell,
  standCreditsPerSwarm,
  STAND_OWNER_SHARE,
  STAND_BUYBACK_SHARE,
  STAND_STABILITY_SHARE,
  STAND_COMMUNITY_SHARE,
  standPriceBoard,
  type StandCurrency,
  type StandVaultState,
  type TradingGood,
} from '@/lib/world/tradingStand/pricing';
import { heldGood } from '@/lib/world/tradingStand/goods';
import {
  TRADING_STAND_EVENT,
  buyFromStand,
  standVaultScope,
  donateGoodsToStand,
  donateToStandVault,
  type StandDonationAsset,
  getPlayerBalances,
  getStandVaultState,
  getStandLocalStock,
  sellToStand,
  type StandScope,
} from '@/lib/world/tradingStand/tradingStandStore';

function useNearbyStand(selfId: string): string | null {
  const [near, setNear] = useState<string | null>(null);
  const stands = useRef<string[]>([]);
  useEffect(() => {
    const read = () => {
      stands.current = listPlacements().filter((r) => r.prefabId === TRADING_STAND_ID).map((r) => r.placementId);
    };
    read();
    return subscribePlacements(read);
  }, []);
  useEffect(() => {
    const poll = () => {
      const self = getBrainPhysics().getBody(selfId);
      if (!self || stands.current.length === 0) { setNear(null); return; }
      const engine = getBuilderBlockEngine();
      const points: StandPoint[] = [];
      for (const id of stands.current) {
        const block = engine.getBlock(`${TRADING_STAND_ID}:${id}`);
        if (block) points.push({ placementId: id, pos: blockWorldPos(block) });
      }
      const hit = nearestStandWithin(self.pos, points);
      setNear(hit?.placementId ?? null);
    };
    poll();
    const t = setInterval(poll, 250);
    return () => clearInterval(t);
  }, [selfId]);
  return near;
}

/**
 * The stand at `placementId` and its owner. Read from the placement record,
 * or from the placed block (its `placedBy`) while a peer's record is still
 * on its way, so a peer's stand is never mistaken for the viewer's own.
 */
export function resolveStand(placementId: string): { placementId: string; ownerId: string; ownerName?: string } | null {
  const rec = listPlacements().find((r) => r.placementId === placementId && r.prefabId === TRADING_STAND_ID);
  if (rec?.actorId) return { placementId, ownerId: rec.actorId, ownerName: rec.ownerName };
  const block = getBuilderBlockEngine().getBlock(`${TRADING_STAND_ID}:${placementId}`);
  const placedBy = block?.meta?.placedBy;
  return typeof placedBy === 'string' && placedBy ? { placementId, ownerId: placedBy } : null;
}

const fmtSwarm = (n: number | null) => (n === null ? '—' : n < 0.001 ? n.toFixed(6) : n.toFixed(4));
const pct = (share: number) => `${Math.round(share * 100)}%`;
const fmtCredits = (n: number | null) => (n === null ? '—' : n.toLocaleString());

/** The proximity prompt plus the window it opens. Mount once over the Brain canvas. */
export function TradingStandPrompt({ selfId, mobile }: { selfId: string; mobile: boolean }) {
  const near = useNearbyStand(selfId);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!near) setOpen(false); }, [near]);
  if (!near && !open) return null;
  return (
    <>
      {near && !open && (
        <Button
          type="button"
          variant="ghost"
          data-testid="trading-stand-prompt"
          onClick={() => setOpen(true)}
          className="absolute left-1/2 z-[70] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-amber-400/60 bg-background/85 px-3 py-1 text-xs font-semibold text-foreground"
          style={{ bottom: mobile ? 'calc(env(safe-area-inset-bottom, 0px) + 15rem)' : 'calc(env(safe-area-inset-bottom, 0px) + 8.5rem)' }}
        >
          <Store className="h-4 w-4 text-amber-400" aria-hidden />
          {STAND_TITLE}
        </Button>
      )}
      <TradingStandModal open={open} onOpenChange={setOpen} selfId={selfId} placementId={near} />
    </>
  );
}

export function TradingStandModal({ open, onOpenChange, selfId, placementId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selfId: string;
  /** The stand being traded at: its owner takes 15% of its sales and can fund it. */
  placementId?: string | null;
}) {
  // Keep the stand that was open even if the player steps back while the window is up.
  const [standId, setStandId] = useState<string | null>(placementId ?? null);
  useEffect(() => { if (placementId) setStandId(placementId); }, [placementId]);
  const standRec = standId ? listPlacements().find((r) => r.placementId === standId) : undefined;
  // Every stand is its own market, whoever opens it: the stand and its owner
  // come from the stand itself, never from the viewer.
  const stand = standId ? resolveStand(standId) : null;
  const isOwner = !!stand && !!selfId && stand.ownerId === selfId;
  const [scope, setScope] = useState<StandScope | null>(null);
  const [state, setState] = useState<StandVaultState | null>(null);
  // Stock including this device's unmined sales and buys (on the chain, awaiting a block).
  const [localStock, setLocalStock] = useState<Partial<Record<TradingGood, number>>>({});
  const [balances, setBalances] = useState({ swarm: 0, credits: 0 });
  const [, setBagTick] = useState(0);
  const [selected, setSelected] = useState<TradingGood>('wood');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);

  // A different stand: drop the last one's figures before this one's load.
  const currentStand = useRef(standId);
  useEffect(() => { currentStand.current = standId; setScope(null); setState(null); setLocalStock({}); }, [standId]);

  const refresh = useCallback(async () => {
    try {
      // Each stand trades from its own vault, and only from a stand: there is
      // no fallback to the viewer's room or Cell market.
      if (!standId) return;
      const s = standVaultScope(standId, resolveStand(standId)?.ownerName);
      const [vault, local, bal] = await Promise.all([getStandVaultState(s), getStandLocalStock(s), getPlayerBalances(selfId)]);
      // A reply for a stand the window has since moved off is dropped.
      if (currentStand.current !== standId) return;
      setScope(s); setState(vault); setLocalStock(local); setBalances(bal);
    } catch (err) {
      console.warn('[TradingStand] refresh failed', err);
    }
  }, [selfId, standId]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const on = () => { void refresh(); };
    window.addEventListener(TRADING_STAND_EVENT, on);
    window.addEventListener('blockchain-transaction', on);
    window.addEventListener('credit-transaction', on);
    const t = setInterval(on, 15_000);
    const unsubBag = subscribeHarvested(() => setBagTick((n) => (n + 1) & 0xfff));
    return () => {
      window.removeEventListener(TRADING_STAND_EVENT, on);
      window.removeEventListener('blockchain-transaction', on);
      window.removeEventListener('credit-transaction', on);
      clearInterval(t);
      unsubBag();
    };
  }, [open, refresh]);

  const board = useMemo(() => (state ? standPriceBoard(state) : []), [state]);
  const n = Number.parseInt(qty, 10);
  const units = Number.isFinite(n) ? n : 0;
  const held = heldGood(selected);
  const label = TRADING_GOODS.find((g) => g.id === selected)?.label ?? selected;

  const quotes = useMemo(() => {
    if (!state || units <= 0) return null;
    return {
      buySwarm: quoteStandBuy(state, selected, units, 'SWARM', balances.swarm),
      buyCredits: quoteStandBuy(state, selected, units, 'CREDITS', balances.credits),
      sellSwarm: quoteStandSell(state, selected, units, 'SWARM', held),
      sellCredits: quoteStandSell(state, selected, units, 'CREDITS', held),
    };
  }, [state, selected, units, balances, held]);

  const trade = async (side: 'buy' | 'sell' | 'donate', currency: StandCurrency) => {
    if (!scope || busy) return;
    setBusy(true);
    try {
      if (side === 'donate') {
        await donateGoodsToStand(selfId, scope, stand, selected, units);
        toast.success(`Stocked the stand with ${units} ${label.toLowerCase()}.`);
      } else {
        const fn = side === 'buy' ? buyFromStand : sellToStand;
        const q = await fn({ userId: selfId, scope, good: selected, qty: units, currency, stand });
        const money = currency === 'SWARM' ? `${fmtSwarm(q.swarm)} SWARM` : `${fmtCredits(q.credits)} Credits`;
        toast.success(side === 'buy' ? `Bought ${units} ${label.toLowerCase()} for ${money}.` : `Sold ${units} ${label.toLowerCase()} for ${money}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The trade did not go through.');
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const action = (text: string, q: { error: string | null } | undefined, run: () => void) => (
    <Button type="button" size="sm" variant="secondary" disabled={busy || !q || !!q.error} title={q?.error ?? undefined} onClick={run} className="h-auto whitespace-normal py-1.5 text-xs">
      {text}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="trading-stand-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Store className="h-5 w-5 text-amber-500" aria-hidden />{STAND_TITLE}</DialogTitle>
          <DialogDescription>
            {scope?.label ?? 'Stand vault'} · 1 SWARM = {state ? fmtCredits(Math.round(standCreditsPerSwarm(state))) : '—'} Credits at market spot.
            Prices rise as a good runs short here and fall as more is sold.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-2 font-medium">Good</th>
                <th className="py-1 pr-2 text-right font-medium">Stock</th>
                <th className="py-1 pr-2 text-right font-medium">Buy</th>
                <th className="py-1 text-right font-medium">Sell</th>
              </tr>
            </thead>
            <tbody>
              {board.map((row) => (
                <tr
                  key={row.good.id}
                  onClick={() => setSelected(row.good.id)}
                  className={`cursor-pointer border-t border-border/50 ${selected === row.good.id ? 'bg-accent/40' : ''}`}
                  data-testid={`stand-row-${row.good.id}`}
                >
                  <td className="py-1.5 pr-2">{row.good.icon} {row.good.label} <span className="text-muted-foreground">({heldGood(row.good.id)})</span></td>
                  <td className="py-1.5 pr-2 text-right tabular-nums" data-testid={`stand-stock-${row.good.id}`}>
                    {localStock[row.good.id] ?? row.stock}
                    {(localStock[row.good.id] ?? row.stock) !== row.stock && (
                      <><br /><span className="text-[10px] text-amber-500" title="Recorded on the chain; waiting for the next block">
                        {(localStock[row.good.id] ?? 0) > row.stock ? '+' : ''}{(localStock[row.good.id] ?? 0) - row.stock} awaiting block
                      </span></>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtSwarm(row.buySwarm)} S<br /><span className="text-muted-foreground">{fmtCredits(row.buyCredits)} Cr</span></td>
                  <td className="py-1.5 text-right tabular-nums">{fmtSwarm(row.sellSwarm)} S<br /><span className="text-muted-foreground">{fmtCredits(row.sellCredits)} Cr</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2 rounded-md border border-border/60 p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">{label}</span>
            <span className="text-muted-foreground">· you hold {held}</span>
            <Input
              type="number" min={1} step={1} inputMode="numeric" value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="ml-auto h-8 w-20" aria-label="Units"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {action(`Buy for ${quotes ? fmtSwarm(quotes.buySwarm.swarm) : '—'} SWARM`, quotes?.buySwarm, () => void trade('buy', 'SWARM'))}
            {action(`Buy for ${quotes ? fmtCredits(quotes.buyCredits.credits) : '—'} Credits`, quotes?.buyCredits, () => void trade('buy', 'CREDITS'))}
            {action(`Sell for ${quotes ? fmtSwarm(quotes.sellSwarm.swarm) : '—'} SWARM`, quotes?.sellSwarm, () => void trade('sell', 'SWARM'))}
            {action(`Sell for ${quotes ? fmtCredits(quotes.sellCredits.credits) : '—'} Credits`, quotes?.sellCredits, () => void trade('sell', 'CREDITS'))}
          </div>
          {quotes && (quotes.buySwarm.error || quotes.sellSwarm.error) && (
            <p className="text-[11px] text-muted-foreground">{quotes.buySwarm.error ?? quotes.sellSwarm.error}</p>
          )}
          {isOwner && scope && !scope.settlesMain && (
            <Button type="button" size="sm" variant="ghost" data-testid="stand-stock-button" disabled={busy || units <= 0 || units > held} onClick={() => void trade('donate', 'SWARM')} className="w-full text-xs">
              Stock this stand with {units > 0 ? units : ''} {label.toLowerCase()} (nothing back)
            </Button>
          )}
          {stand && (
            <p className="text-[11px] text-muted-foreground" data-testid="stand-owner-share">
              {isOwner
                ? `You own this stand: you receive ${pct(STAND_OWNER_SHARE)} of every sale it makes, including ${pct(STAND_OWNER_SHARE)} back when you buy here.`
                : `${standRec?.ownerName ?? 'The owner'} receives ${pct(STAND_OWNER_SHARE)} of what you pay here.`}
              {` Each sale splits like a creator market: ${pct(STAND_BUYBACK_SHARE + STAND_STABILITY_SHARE)} to this stand's vault, ${pct(STAND_OWNER_SHARE)} to its owner, ${pct(STAND_COMMUNITY_SHARE)} to the community pool.`}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Wallet: {fmtSwarm(balances.swarm)} SWARM · {fmtCredits(balances.credits)} Credits. 40% of the stand vault is a protected floor; one trade takes at most 10% of its liquid layer or of a good's stock.
          </p>
        </div>
        {isOwner && scope && stand && (
          <details className="rounded-md border border-border/60 p-3" data-testid="stand-owner-funding">
            <summary className="cursor-pointer text-sm font-semibold">Fund your stand</summary>
            <div className="mt-2">
              <StandFundingForm selfId={selfId} scope={scope} stand={stand} onDone={() => void refresh()} />
            </div>
          </details>
        )}
      </DialogContent>
    </Dialog>
  );
}


/** A private Cell stand's owner adds SWARM, Credits or synced tokens to its own vault. */
function StandFundingForm({ selfId, scope, stand, onDone }: {
  selfId: string;
  scope: StandScope;
  stand: { placementId: string; ownerId: string };
  onDone: () => void;
}) {
  const options = useMemo(() => {
    const tokens = (() => {
      try {
        return listCustomTokens(selfId).map((t) => {
          const ref = customTokenRef(t);
          return { id: `token:${ref}`, label: t.symbol, asset: { kind: 'TOKEN', contract: ref, symbol: t.symbol } as StandDonationAsset, balance: getAvailableTokenBalance(selfId, ref) };
        }).filter((t) => t.balance > 0);
      } catch { return []; }
    })();
    return [
      { id: 'SWARM', label: 'SWARM', asset: { kind: 'SWARM' } as StandDonationAsset, balance: null as number | null },
      { id: 'CREDITS', label: 'Credits', asset: { kind: 'CREDITS' } as StandDonationAsset, balance: null as number | null },
      ...tokens,
    ];
  }, [selfId]);
  const [assetId, setAssetId] = useState('SWARM');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const option = options.find((o) => o.id === assetId) ?? options[0];
  const fund = async () => {
    setBusy(true);
    try {
      await donateToStandVault(selfId, scope, stand, option.asset, Number(amount));
      toast.success(`Added ${amount} ${option.label} to your stand.`);
      setAmount('');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not fund the stand.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">Goes into this stand's own vault, not the main Market Vault. It pays players who sell goods here; 40% always stays as the protected floor.</p>
      <div className="flex gap-2">
        <select
          aria-label="Asset" value={option.id} onChange={(e) => setAssetId(e.target.value)} disabled={busy}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.balance !== null ? ` · ${o.balance}` : ''}</option>)}
        </select>
        <Input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 flex-1" aria-label="Amount" />
        <Button type="button" size="sm" disabled={busy || !(Number(amount) > 0)} onClick={() => void fund()}>Fund</Button>
      </div>
    </div>
  );
}
