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
  standPriceBoard,
  type StandCurrency,
  type StandVaultState,
  type TradingGood,
} from '@/lib/world/tradingStand/pricing';
import { heldGood } from '@/lib/world/tradingStand/goods';
import {
  TRADING_STAND_EVENT,
  buyFromStand,
  currentStandScope,
  donateGoodsToStand,
  getPlayerBalances,
  getStandVaultState,
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

const fmtSwarm = (n: number | null) => (n === null ? '—' : n < 0.001 ? n.toFixed(6) : n.toFixed(4));
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
      <TradingStandModal open={open} onOpenChange={setOpen} selfId={selfId} />
    </>
  );
}

export function TradingStandModal({ open, onOpenChange, selfId }: { open: boolean; onOpenChange: (open: boolean) => void; selfId: string }) {
  const [scope, setScope] = useState<StandScope | null>(null);
  const [state, setState] = useState<StandVaultState | null>(null);
  const [balances, setBalances] = useState({ swarm: 0, credits: 0 });
  const [, setBagTick] = useState(0);
  const [selected, setSelected] = useState<TradingGood>('wood');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await currentStandScope();
      const [vault, bal] = await Promise.all([getStandVaultState(s), getPlayerBalances(selfId)]);
      setScope(s); setState(vault); setBalances(bal);
    } catch (err) {
      console.warn('[TradingStand] refresh failed', err);
    }
  }, [selfId]);

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
        await donateGoodsToStand(selfId, scope, selected, units);
        toast.success(`Stocked the stand with ${units} ${label.toLowerCase()}.`);
      } else {
        const fn = side === 'buy' ? buyFromStand : sellToStand;
        const q = await fn({ userId: selfId, scope, good: selected, qty: units, currency });
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
                  <td className="py-1.5 pr-2 text-right tabular-nums">{row.stock}</td>
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
          {scope && !scope.settlesMain && (
            <Button type="button" size="sm" variant="ghost" disabled={busy || units <= 0 || units > held} onClick={() => void trade('donate', 'SWARM')} className="w-full text-xs">
              Stock this stand with {units > 0 ? units : ''} {label.toLowerCase()} (nothing back)
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">
            Wallet: {fmtSwarm(balances.swarm)} SWARM · {fmtCredits(balances.credits)} Credits. 40% of the stand vault is a protected floor; one trade takes at most 10% of its liquid layer or of a good's stock.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

