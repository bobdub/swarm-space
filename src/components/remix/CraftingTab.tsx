/**
 * CraftingTab — the Blacksmith Forge surface.
 *
 * Two modes:
 *   - Craft: the Forge locks onto the next hollow (unsealed) SWARM coin and
 *     takes gathered materials (Wood, Stone, Fiber, Water, Honey, Gems,
 *     Gold) from the deposit shelf, capped at 85% fill. Striking engraves
 *     the seal into the Wallet. Crafted coins travel across projects.
 *   - Smelt: break a sealed coin back into project-scoped chemicals; the
 *     coin returns to the community pool.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Hammer, Flame, RefreshCw, X, Coins, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import type { SwarmCoin } from '@/lib/blockchain/types';
import {
  CRAFT_FILL_CAP,
  cancelCraft,
  contentsMass,
  depositMaterial,
  finalizeCraft,
  getProgress,
  hydrateCoinCrafting,
  listCraftableCoins,
  listSealedUserCoins,
  sealTierForMass,
  smeltCoin,
  subscribeCrafting,
  unitsThatFit,
  type CraftProgress,
} from '@/lib/remix/coinCraftingStore';
import {
  LAB_MATERIALS,
  getLabMaterial,
  labMaterialStocks,
  materialFromKey,
  subscribeLabMaterialStocks,
  type LabMaterial,
  type LabMaterialId,
} from '@/lib/remix/labMaterials';
import type { EngravingTier } from '@/lib/blockchain/engravingTiers';
import { getActiveProjectId } from '@/lib/remix/labProjectBridge';
import { getCurrentUser } from '@/lib/auth';

/** The Wallet reads coins by account id, so the Forge must seal to it too. */
function currentUserId(): string {
  try {
    const id = getCurrentUser()?.id;
    if (id) return id;
  } catch { /* fall through */ }
  return (typeof localStorage !== 'undefined' && localStorage.getItem('peerId')) || 'local';
}

export function CraftingTab() {
  const [mode, setMode] = useState<'craft' | 'smelt'>('craft');
  return (
    <div className="flex flex-col gap-3 py-3">
      <header className="flex items-center justify-between rounded-md border border-amber-900/30 bg-gradient-to-r from-amber-950/40 via-orange-950/30 to-stone-900/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-400" />
          <h2 className="text-sm font-semibold tracking-tight text-foreground">The Forge</h2>
          <span className="text-[11px] text-amber-100/80">Craft a coin that travels through projects</span>
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'craft' | 'smelt')}>
          <TabsList className="h-8">
            <TabsTrigger value="craft" className="gap-1 text-[11px]"><Hammer className="h-3 w-3" /> Craft Coin</TabsTrigger>
            <TabsTrigger value="smelt" className="gap-1 text-[11px]"><ArrowRightLeft className="h-3 w-3" /> Smelt Coin</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>
      <Tabs value={mode} className="w-full">
        <TabsContent value="craft"><CraftView /></TabsContent>
        <TabsContent value="smelt"><SmeltView /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Craft ───────────────────────────────────────────────────────────────

/** Coins with forge progress first, then the player's own, then pool coins. */
function orderHollowCoins(coins: SwarmCoin[], userId: string, progressMap: Record<string, CraftProgress>): SwarmCoin[] {
  const rank = (c: SwarmCoin) => (progressMap[c.coinId] ? 0 : c.ownerId === userId ? 1 : 2);
  return [...coins].sort((a, b) => rank(a) - rank(b));
}

function CraftView() {
  const { toast } = useToast();
  const userId = currentUserId();
  const [coins, setCoins] = useState<SwarmCoin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeCoinId, setActiveCoinId] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, CraftProgress>>({});
  const [stocks, setStocks] = useState<Record<LabMaterialId, number>>(() => labMaterialStocks());
  const [busy, setBusy] = useState(false);

  const refreshCoins = useCallback(async () => {
    const list = await listCraftableCoins(userId);
    setCoins(list);
    setLoaded(true);
  }, [userId]);

  useEffect(() => { void hydrateCoinCrafting(); void refreshCoins(); }, [refreshCoins]);
  useEffect(() => subscribeCrafting(setProgressMap), []);
  useEffect(() => subscribeLabMaterialStocks(setStocks), []);

  const ordered = useMemo(() => orderHollowCoins(coins, userId, progressMap), [coins, userId, progressMap]);
  // Lock onto the next hollow coin automatically; keep the pick while it is still hollow.
  useEffect(() => {
    if (ordered.length === 0) { setActiveCoinId(null); return; }
    setActiveCoinId((cur) => (cur && ordered.some((c) => c.coinId === cur) ? cur : ordered[0].coinId));
  }, [ordered]);

  const activeCoin = ordered.find((c) => c.coinId === activeCoinId) ?? null;
  const activeIndex = activeCoin ? ordered.indexOf(activeCoin) : -1;
  const prog = activeCoin ? (progressMap[activeCoin.coinId] ?? getProgress(activeCoin.coinId)) : null;
  const fill = prog?.fill ?? 0;
  const atCap = fill >= CRAFT_FILL_CAP - 0.0001;
  const mass = contentsMass(prog?.contents ?? {});

  const cycleCoin = () => {
    if (ordered.length < 2) return;
    setActiveCoinId(ordered[(activeIndex + 1) % ordered.length].coinId);
  };

  const handleCraft = async () => {
    if (!activeCoin || !prog || prog.fill <= 0 || busy) return;
    setBusy(true);
    try {
      const sealed = await finalizeCraft(activeCoin.coinId, userId);
      const tier = sealed.creatorProof?.tier ?? 'basic';
      toast({
        title: `Coin sealed · ${TIER_LABEL[tier]}`,
        description: 'Engraved with your Creator Proof and added to your Wallet. It travels with you through projects.',
      });
      await refreshCoins();
    } catch (err) {
      toast({ title: 'Craft failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally { setBusy(false); }
  };

  const handleCancel = async () => {
    if (!activeCoin) return;
    await cancelCraft(activeCoin.coinId);
    toast({ title: 'Craft cancelled', description: 'Materials returned to your bag.' });
  };

  const handleDeposit = (material: LabMaterialId, units: number) => {
    if (!activeCoin) return;
    const res = depositMaterial(activeCoin, material, units);
    if (res.ok === false) {
      const msg = res.reason === 'at-cap'
        ? `That would carry the coin past the ${Math.round(CRAFT_FILL_CAP * 100)}% cap.`
        : res.reason === 'insufficient-atoms'
          ? `Not enough ${getLabMaterial(material).label}. Gather more in the world.`
          : 'Invalid amount.';
      toast({ title: 'Cannot deposit', description: msg, variant: 'destructive' });
    }
  };

  if (loaded && coins.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-amber-900/40 bg-stone-950/40 p-6 text-center">
        <Coins className="mx-auto mb-2 h-6 w-6 text-amber-500/70" />
        <p className="text-sm text-foreground/80">No hollow SWARM coins available.</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Mine a SWARM coin first. Only hollow (unsealed) coins can be crafted.</p>
        <Button type="button" size="sm" variant="outline" className="mt-3 gap-1 text-[11px]" onClick={() => void refreshCoins()}>
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_280px]">
      {/* Anvil */}
      <section className="flex flex-col items-center justify-center gap-3 rounded-md border border-amber-900/30 bg-gradient-to-b from-stone-950/60 to-stone-900/40 p-6">
        <div className="flex items-center gap-1.5" data-testid="forge-coin-badge">
          <span className="rounded-full border border-amber-700/50 bg-amber-950/40 px-2.5 py-0.5 font-mono text-[11px] text-amber-100" title={activeCoin?.coinId}>
            {activeCoin ? `${activeCoin.coinId.slice(0, 10)}…` : 'Finding a hollow coin…'}
          </span>
          {ordered.length > 1 && (
            <button
              type="button"
              onClick={cycleCoin}
              aria-label="Next hollow coin"
              title={`Coin ${activeIndex + 1} of ${ordered.length}. Tap for the next one.`}
              className="flex items-center gap-1 rounded-full border border-amber-900/40 px-2 py-0.5 text-[10px] text-amber-300/90 hover:bg-amber-900/30"
            >
              <RefreshCw className="h-3 w-3" /> {activeIndex + 1}/{ordered.length}
            </button>
          )}
        </div>
        <ForgeGauge fill={fill} />
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-widest text-amber-500/80">Anvil</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Seal tier: <span className="font-medium text-amber-200">{TIER_LABEL[sealTierForMass(mass)]}</span>
            {' '}· hard cap {Math.round(CRAFT_FILL_CAP * 100)}%
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={handleCancel} disabled={!prog || busy} className="h-8 gap-1 text-[11px]">
            <X className="h-3 w-3" /> Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleCraft}
            disabled={!prog || prog.fill <= 0 || busy}
            className="h-8 gap-1 bg-amber-600 text-stone-950 hover:bg-amber-500 text-[11px]"
          >
            <Hammer className="h-3 w-3" /> {busy ? 'Striking…' : 'Strike & Seal'}
          </Button>
        </div>
        {prog && (
          <div className="flex flex-wrap justify-center gap-1">
            {Object.entries(prog.contents).map(([key, n]) => {
              const mat = materialFromKey(key);
              return (
                <span key={key} className="rounded-full bg-amber-900/40 px-2 py-[1px] text-[10px] text-amber-200">
                  {mat ? `${mat.icon} ${mat.label}` : key} ×{n}
                </span>
              );
            })}
          </div>
        )}
      </section>

      {/* Deposit shelf */}
      <aside className="rounded-md border border-amber-900/30 bg-stone-950/40 p-2">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-amber-500/80">Gathered materials</div>
        <ul className="flex flex-col gap-1.5">
          {LAB_MATERIALS.map((m) => (
            <MaterialRow
              key={m.id}
              material={m}
              available={stocks[m.id] ?? 0}
              fits={activeCoin ? unitsThatFit(activeCoin, m.id) : 0}
              disabled={!activeCoin || atCap}
              onDeposit={(n) => handleDeposit(m.id, n)}
            />
          ))}
        </ul>
        {atCap && (
          <p className="mt-2 text-[10px] text-amber-400">At cap. Strike to seal.</p>
        )}
      </aside>
    </div>
  );
}

const TIER_LABEL: Record<EngravingTier, string> = { basic: 'Basic', rare: 'Rare', legendary: 'Legendary' };

function MaterialRow({
  material, available, fits, disabled, onDeposit,
}: { material: LabMaterial; available: number; fits: number; disabled: boolean; onDeposit: (n: number) => void }) {
  const [n, setN] = useState<number>(1);
  const max = Math.max(1, Math.min(available, fits));
  return (
    <li className="flex items-center gap-2 rounded border border-amber-900/20 bg-stone-900/40 p-1.5" data-testid={`forge-material-${material.id}`}>
      <span className="h-4 w-4 shrink-0 rounded-full border border-white/15" style={{ backgroundColor: material.color }} aria-hidden="true" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[11px] font-medium text-amber-100">{material.label}</span>
        <span className="text-[9px] text-muted-foreground">have {available} · {material.forgeMass}u each</span>
      </span>
      <Input
        type="number"
        min={1}
        max={max}
        value={n}
        onChange={(e) => setN(Math.max(1, Math.min(max, Number(e.target.value) || 1)))}
        className="ml-auto h-6 w-12 px-1 text-[11px]"
        disabled={disabled || available <= 0}
        aria-label={`${material.label} units`}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || available <= 0 || n > available || n > fits}
        onClick={() => onDeposit(n)}
        className="h-6 px-2 text-[10px]"
      >
        Add
      </Button>
    </li>
  );
}

function ForgeGauge({ fill }: { fill: number }) {
  const pct = Math.max(0, Math.min(1, fill));
  const R = 56;
  const C = 2 * Math.PI * R;
  const dash = C * pct;
  const capDash = C * CRAFT_FILL_CAP;
  return (
    <div className="relative">
      <svg width={140} height={140} viewBox="0 0 140 140" className="-rotate-90">
        <defs>
          <linearGradient id="ember" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="60%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#7c2d12" />
          </linearGradient>
        </defs>
        <circle cx={70} cy={70} r={R} stroke="hsl(var(--border))" strokeOpacity={0.4} strokeWidth={10} fill="none" />
        {/* cap marker */}
        <circle
          cx={70} cy={70} r={R}
          stroke="#78350f" strokeOpacity={0.6} strokeWidth={2}
          strokeDasharray={`${capDash} ${C - capDash}`}
          fill="none"
        />
        <circle
          cx={70} cy={70} r={R}
          stroke="url(#ember)" strokeWidth={10} strokeLinecap="round"
          strokeDasharray={`${dash} ${C - dash}`}
          fill="none"
          style={{ filter: 'drop-shadow(0 0 6px rgba(251,146,60,0.6))', transition: 'stroke-dasharray 250ms ease' }}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-amber-300">{Math.round(pct * 100)}%</span>
        <span className="text-[10px] uppercase tracking-widest text-amber-500/80">fill</span>
      </div>
    </div>
  );
}

// ── Smelt ───────────────────────────────────────────────────────────────

function SmeltView() {
  const { toast } = useToast();
  const userId = currentUserId();
  const [coins, setCoins] = useState<SwarmCoin[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const projectId = useMemo(() => getActiveProjectId(), []);

  const refresh = useCallback(async () => {
    const list = await listSealedUserCoins(userId);
    setCoins(list);
  }, [userId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const handleSmelt = async () => {
    if (!selected || !projectId || busy) return;
    setBusy(true);
    try {
      await smeltCoin(selected, projectId);
      toast({ title: 'Coin smelted', description: 'Chemicals delivered to the project. Coin returned to the community pool.' });
      setSelected(null);
      await refresh();
    } catch (err) {
      toast({ title: 'Smelt failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally { setBusy(false); }
  };

  if (!projectId) {
    return (
      <div className="rounded-md border border-dashed border-amber-900/40 bg-stone-950/40 p-6 text-center text-[12px] text-muted-foreground">
        Open a project first — smelted chemicals flow into the active project's pool.
      </div>
    );
  }

  if (coins.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-amber-900/40 bg-stone-950/40 p-6 text-center">
        <Coins className="mx-auto mb-2 h-6 w-6 text-amber-500/70" />
        <p className="text-sm text-foreground/80">No sealed coins in your wallet.</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Craft a coin first to have something to smelt.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">
        Smelting unseals a coin's chemicals into <span className="font-medium text-foreground">this project</span> ({projectId.slice(0, 8)}…). The coin itself returns to the community pool. One at a time.
      </p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {coins.map((c) => {
          const active = selected === c.coinId;
          return (
            <li key={c.coinId}>
              <button
                type="button"
                onClick={() => setSelected(active ? null : c.coinId)}
                className={`group flex w-full flex-col gap-2 rounded-md border p-3 text-left transition-colors ${
                  active ? 'border-amber-500 bg-amber-950/30' : 'border-amber-900/30 bg-stone-950/40 hover:border-amber-700/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-foreground/80">{c.coinId.slice(0, 14)}…</span>
                  <span className="text-[10px] text-amber-400">{Math.round((c.fill ?? 1) * 100)}%</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(c.wrappedChemicals ?? []).map((p) => {
                    const mat = materialFromKey(p.symbol);
                    return (
                      <span key={p.symbol} className="rounded-full bg-amber-900/40 px-1.5 py-[1px] text-[10px] text-amber-200">{mat ? mat.label : p.symbol} ×{p.count}</span>
                    );
                  })}
                  {(!c.wrappedChemicals || c.wrappedChemicals.length === 0) && (
                    <span className="text-[10px] text-muted-foreground">No chemical payload.</span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={handleSmelt}
          disabled={!selected || busy}
          className="h-8 gap-1 bg-orange-600 text-stone-950 hover:bg-orange-500 text-[11px]"
        >
          <Flame className="h-3 w-3" /> {busy ? 'Smelting…' : 'Smelt to Project'}
        </Button>
      </div>
    </div>
  );
}

export default CraftingTab;