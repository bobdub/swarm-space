/**
 * BarMenuPanel — the drinks menu at the bar counter.
 *
 * A patron walks up to the counter, holds the prompt, and orders for
 * themselves. Payment goes into the Market Vault like a donation, but onto
 * the bar tab: the patron's own drinking record, kept apart from the Donor
 * Leaderboard. The panel shows the menu, the patron's record and who has
 * been drinking lately.
 */

import { useCallback, useEffect, useState } from 'react';
import { Beer, Loader2, Minus, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { get } from '@/lib/store';
import { getCurrentUser } from '@/lib/auth';
import type { User } from '@/types';
import { getSpendableSwarmBalance } from '@/lib/blockchain/token';
import {
  DRINKS_MENU,
  MAX_DRINKS_PER_ORDER,
  formatDrinkCount,
  formatSwarm,
  loadBarTab,
  orderCost,
  type BarTab,
} from '@/lib/blockchain/infinity/barTab';
import { barOrderProblem, orderAtBar } from '@/lib/pub/barOrders';
import { getLocalMeshPeerId } from '@/lib/streaming/webrtcSignalingBridge.standalone';

const REFRESH_EVENTS = ['blockchain-transaction', 'reward-pool-update', 'swarm-block-mined', 'peer-gift-outcome'];
const EMPTY: BarTab = { patrons: [], drinksPoured: 0, takings: 0, orderCount: 0 };
const NAME_TIMEOUT_MS = 3000;

async function patronName(userId: string): Promise<string> {
  const fallback = `@${userId.slice(0, 8)}`;
  const me = getCurrentUser();
  if (me?.id === userId) return me.displayName || me.username || fallback;
  const user = await Promise.race([
    get<User>('users', userId).catch(() => undefined),
    new Promise<undefined>((resolve) => window.setTimeout(resolve, NAME_TIMEOUT_MS)),
  ]);
  return user?.displayName || user?.username || fallback;
}

function useBarTab(): { tab: BarTab; names: Record<string, string>; ready: boolean } {
  const [state, setState] = useState({ tab: EMPTY, names: {} as Record<string, string>, ready: false });
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const tab = await loadBarTab();
        if (!alive) return;
        setState((prev) => ({ ...prev, tab, ready: true }));
        const entries = await Promise.all(tab.patrons.slice(0, 12).map(async (p) => [p.userId, await patronName(p.userId)] as const));
        if (alive) setState((prev) => (prev.tab === tab ? { ...prev, names: { ...prev.names, ...Object.fromEntries(entries) } } : prev));
      } catch (err) {
        console.warn('[BarTab] Could not read the ledger:', err);
        if (alive) setState((prev) => ({ ...prev, ready: true }));
      }
    };
    void refresh();
    const onUpdate = () => void refresh();
    REFRESH_EVENTS.forEach((e) => window.addEventListener(e, onUpdate));
    const timer = window.setInterval(onUpdate, 60_000);
    return () => {
      alive = false;
      REFRESH_EVENTS.forEach((e) => window.removeEventListener(e, onUpdate));
      window.clearInterval(timer);
    };
  }, []);
  return state;
}

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function BarMenuPanel({
  selfId,
  username,
  onClose,
}: {
  selfId: string;
  username: string;
  onClose: () => void;
}) {
  const user = getCurrentUser();
  const problem = barOrderProblem(user);
  const { tab, names, ready } = useBarTab();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [view, setView] = useState<'menu' | 'tab'>('menu');

  const refreshBalance = useCallback(async () => {
    if (!user || problem) return;
    try { setBalance(await getSpendableSwarmBalance(user.id)); } catch { /* offline is fine */ }
  }, [user, problem]);
  useEffect(() => { void refreshBalance(); }, [refreshBalance]);

  const mine = user ? tab.patrons.find((p) => p.userId === user.id) : undefined;

  const order = async (drinkId: string) => {
    const n = qty[drinkId] ?? 1;
    setBusy(drinkId);
    try {
      let mesh = '';
      try { mesh = getLocalMeshPeerId() ?? ''; } catch { /* not on the mesh yet */ }
      const { drink, cost } = await orderAtBar({ drinkId, qty: n, bodyIds: [selfId, mesh], fromName: username });
      toast.success(`${drink.emoji} ${n > 1 ? `${n} × ` : ''}${drink.name} poured. ${formatSwarm(cost)} on your tab, paid into the vault.`);
      setQty((q) => ({ ...q, [drinkId]: 1 }));
      void refreshBalance();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The bar is closed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-testid="bar-menu-panel"
      className="pointer-events-auto flex max-h-[min(78vh,40rem)] w-[min(92vw,24rem)] flex-col rounded-2xl border border-amber-400/50 bg-[hsla(25,55%,8%,0.95)] p-4 text-foreground shadow-[0_0_28px_hsla(35,80%,50%,0.3)]"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-amber-200">
            <Beer className="h-4 w-4" /> The Bar
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Every drink is paid into the Market Vault and kept on the bar tab, not the Donor Leaderboard.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Step away from the bar"
          className="rounded-full border border-foreground/25 p-1.5 text-foreground/70 hover:bg-foreground/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 flex gap-1 rounded-full bg-foreground/10 p-0.5 text-[11px] font-semibold uppercase tracking-wide">
        {(['menu', 'tab'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`flex-1 rounded-full px-3 py-1 ${view === v ? 'bg-amber-400 text-black' : 'text-foreground/70 hover:bg-foreground/10'}`}
          >
            {v === 'menu' ? 'Drinks menu' : `Bar tab · ${tab.patrons.length}`}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {view === 'menu' ? (
          <>
            {problem ? (
              <p className="mb-2 rounded-lg border border-dashed border-foreground/25 px-3 py-2 text-xs text-muted-foreground">{problem}</p>
            ) : (
              <div className="mb-2 flex justify-between text-[11px] text-muted-foreground">
                <span>Your wallet</span>
                <span className="font-mono tabular-nums">{balance === null ? '…' : formatSwarm(balance)}</span>
              </div>
            )}
            <ul className="space-y-1.5">
              {DRINKS_MENU.map((d) => {
                const n = qty[d.id] ?? 1;
                const cost = orderCost(d, n);
                const short = balance !== null && cost > balance;
                return (
                  <li key={d.id} className="rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{d.emoji} {d.name}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-amber-200">{formatSwarm(d.price)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{d.blurb}</p>
                    {!problem && (
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`One fewer ${d.name}`}
                            disabled={n <= 1 || !!busy}
                            onClick={() => setQty((q) => ({ ...q, [d.id]: Math.max(1, n - 1) }))}
                            className="rounded-full border border-foreground/25 p-1 disabled:opacity-40"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-5 text-center font-mono text-xs tabular-nums">{n}</span>
                          <button
                            type="button"
                            aria-label={`One more ${d.name}`}
                            disabled={n >= MAX_DRINKS_PER_ORDER || !!busy}
                            onClick={() => setQty((q) => ({ ...q, [d.id]: Math.min(MAX_DRINKS_PER_ORDER, n + 1) }))}
                            className="rounded-full border border-foreground/25 p-1 disabled:opacity-40"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={!!busy || short}
                          onClick={() => void order(d.id)}
                          title={short ? 'Not enough spendable SWARM' : undefined}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-black hover:bg-amber-300 disabled:opacity-40"
                        >
                          {busy === d.id && <Loader2 className="h-3 w-3 animate-spin" />}
                          {short ? 'Short' : `Order · ${formatSwarm(cost)}`}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <section className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2">
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-200">Your drinking record</h3>
              {!user ? (
                <p className="text-xs text-muted-foreground">Sign in to keep a record.</p>
              ) : !mine ? (
                <p className="text-xs text-muted-foreground">Nothing on your tab yet. The first one is on you.</p>
              ) : (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span>Drinks</span><span className="font-mono tabular-nums">{mine.drinks}</span></div>
                  <div className="flex justify-between"><span>Paid into the vault</span><span className="font-mono tabular-nums">{formatSwarm(mine.spent)}</span></div>
                  {mine.usual && <div className="flex justify-between"><span>Your usual</span><span>{mine.usual.name}</span></div>}
                  <div className="flex justify-between"><span>First drink</span><span>{ago(mine.firstAt)}</span></div>
                  <ul className="mt-1 space-y-0.5 border-t border-foreground/10 pt-1 text-[11px] text-muted-foreground">
                    {mine.history.slice(0, 6).map((o) => (
                      <li key={o.txId} className="flex justify-between gap-2">
                        <span className="truncate">{o.qty > 1 ? `${o.qty} × ` : ''}{o.name}</span>
                        <span className="shrink-0">{ago(o.at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              On the tab · {formatDrinkCount(tab.drinksPoured)} poured
            </h3>
            {!ready ? (
              <p className="text-xs text-muted-foreground">Reading the ledger…</p>
            ) : tab.patrons.length === 0 ? (
              <p className="text-xs text-muted-foreground">The tab is empty. Be the first to order.</p>
            ) : (
              <ul className="space-y-1">
                {tab.patrons.slice(0, 12).map((p) => (
                  <li
                    key={p.userId}
                    className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs ${p.userId === user?.id ? 'bg-amber-400/10' : 'bg-foreground/5'}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{names[p.userId] ?? `@${p.userId.slice(0, 8)}`}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {p.usual ? `${p.usual.name} · ` : ''}{ago(p.lastAt)}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">{formatDrinkCount(p.drinks)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
