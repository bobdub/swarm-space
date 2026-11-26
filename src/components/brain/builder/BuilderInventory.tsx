/**
 * BuilderInventory — the transparent middle-of-screen build panel.
 *
 * Replaces the bottom prefab dock as the place you choose what to make.
 * The world stays visible (and audible) behind it: the backdrop is a soft
 * wash, not an opaque sheet, and mic / camera / chat are untouched.
 *
 * Everything here is a lens over existing state:
 *   • totals come from `materials.ts`, which folds the element bag into
 *     Wood / Stone / Water / Fibre / Food — nothing is re-persisted;
 *   • costs are derived from each prefab's `constituents`, never typed;
 *   • picking an item only sets `builder.selectPrefab`, which arms the
 *     ghost. The lattice is still written solely by the block engine.
 *
 * Project rules: `role="form"` (no native <form>), every button
 * `type="button"`.
 */
import { useEffect, useMemo, useState } from 'react';
import { X, Hammer, Plus } from 'lucide-react';
import {
  getPrefab,
  listPrefabsBySection,
  type Prefab,
  type PrefabSectionId,
} from '@/lib/brain/prefabHouseCatalog';
import {
  MATERIALS,
  GATHERED_GOODS,
  gatheredGoodTotals,
  materialTotals,
  subscribeMaterials,
  prefabCostFor,
  formatCost,
  checkAffordable,
  describeMissing,
  type MaterialId,
} from '@/lib/world/materials';
import { getToolAny } from '@/lib/brain/toolCatalog';
import { subscribeHarvested } from '@/lib/remix/harvestedInventory';
import { COOKABLE_FOODS, cookedTotals } from '@/lib/world/cooking';
import { BuilderOptionsPanel } from '@/components/brain/builder/BuilderOptionsPanel';
import { ToolPurchaseCard } from '@/components/brain/builder/ToolPurchaseCard';
import { ownsTool, TOOL_PURCHASE_EVENT } from '@/lib/world/toolPurchases';
import { subscribeMintedPrefabs, type MintedRecord } from '@/lib/remix/mintedPrefabsStore';
import { subscribeForgedTools, type ForgedToolRecord } from '@/lib/brain/toolMintStore';
import { LabTab } from '@/components/remix/LabTab';
import type { UseBrainBuilder } from '@/lib/brain/useBrainBuilder';

export interface InventorySection {
  id: string;
  label: string;
  /** Catalog sections folded into this panel section. */
  sources: PrefabSectionId[];
}

/** Plain-words grouping of the catalog. */
export const INVENTORY_SECTIONS: InventorySection[] = [
  { id: 'gathered', label: 'Gathered', sources: [] },
  { id: 'structures', label: 'Structures', sources: ['foundations', 'floors', 'walls'] },
  { id: 'openings', label: 'Doors & Windows', sources: ['doors', 'windows'] },
  { id: 'roofs', label: 'Roofs', sources: ['roofs'] },
  { id: 'tools', label: 'Tools', sources: ['tools', 'consumables'] },
  // Right below Tools: your minted prefabs, forged tools and the canvas.
  { id: 'lab', label: 'Lab', sources: [] },
  { id: 'options', label: 'Options', sources: [] },
];

interface BuilderInventoryProps {
  open: boolean;
  builder: UseBrainBuilder;
  onClose: () => void;
  /**
   * The panel's X button. Leaves Builder Mode entirely (grid, ghost and
   * plot state go with it), matching the hammer toggle. Falls back to
   * `onClose` when not provided. Picking an item still uses `onClose`,
   * so the player stays in build mode to place it.
   */
  onExit?: () => void;
  /** Local peer id — used by the Options tab (dev roles, land). */
  selfId?: string;
  /** Equip a catalog tool straight into the hand slot. */
  onEquipTool?: (prefabId: string) => void;
  /** Project this Brain belongs to; absent in the Main Brain. */
  projectId?: string | null;
  projectName?: string;
}

export function BuilderInventory({
  open, builder, onClose, onExit, selfId, onEquipTool, projectId = null, projectName,
}: BuilderInventoryProps) {
  const [mints, setMints] = useState<MintedRecord[]>([]);
  const [forged, setForged] = useState<ForgedToolRecord[]>([]);
  useEffect(() => subscribeMintedPrefabs(setMints), []);
  useEffect(() => subscribeForgedTools(setForged), []);
  const [sectionId, setSectionId] = useState<string>('structures');
  /** The Lab canvas, opened in place inside the Lab section. */
  const [labOpen, setLabOpen] = useState(false);
  useEffect(() => { if (!open || sectionId !== 'lab') setLabOpen(false); }, [open, sectionId]);
  const [totals, setTotals] = useState<Record<MaterialId, number>>(() => materialTotals());

  useEffect(() => subscribeMaterials(setTotals), []);
  // Honey, eggs, chickens, fish, sharks and gems: gathered goods that are not building materials.
  const [goods, setGoods] = useState(() => gatheredGoodTotals());
  useEffect(() => subscribeHarvested(() => setGoods(gatheredGoodTotals())), []);
  // Meals cooked on a fire pit's grill (never sold at the Trading Stand).
  const [cooked, setCooked] = useState(() => cookedTotals());
  useEffect(() => subscribeHarvested(() => setCooked(cookedTotals())), []);
  // Market tools (a `priceSwarm` prefab) this player has bought.
  const [owned, setOwned] = useState<Record<string, boolean>>({});
  const [buying, setBuying] = useState<Prefab | null>(null);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Lab canvas open: Esc goes back to the Lab list, and only that.
        // (The fullscreen canvas catches its own Esc before this runs.)
        if (labOpen) { e.stopImmediatePropagation(); setLabOpen(false); return; }
        onClose();
      }
    };
    // Capture phase, so the Lab's "back" wins over the scene's close-on-Esc.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, labOpen]);

  const section = useMemo(
    () => INVENTORY_SECTIONS.find((s) => s.id === sectionId) ?? INVENTORY_SECTIONS[1],
    [sectionId],
  );

  const items = useMemo<Prefab[]>(() => {
    const out: Prefab[] = [];
    for (const src of section.sources) out.push(...listPrefabsBySection(src));
    return out;
  }, [section]);

  // Lab: assets minted into this Brain (the Main Brain's shared catalog is
  // the untagged ones), then every tool you forged; tools travel with you.
  const labItems = useMemo<Prefab[]>(() => {
    const out: Prefab[] = [];
    const seen = new Set<string>();
    for (const r of mints) {
      if (projectId ? r.projectId !== projectId : !!r.projectId) continue;
      if (seen.has(r.prefab.id)) continue;
      seen.add(r.prefab.id);
      out.push(r.prefab);
    }
    for (const t of forged) {
      const p = getPrefab(t.id);
      if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
    return out;
  }, [mints, forged, projectId]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const refresh = () => {
      const sold = items.filter((p) => p.priceSwarm);
      void Promise.all(sold.map(async (p) => [p.id, await ownsTool(selfId, p.id).catch(() => false)] as const))
        .then((rows) => { if (live) setOwned(Object.fromEntries(rows)); });
    };
    refresh();
    window.addEventListener(TOOL_PURCHASE_EVENT, refresh);
    return () => { live = false; window.removeEventListener(TOOL_PURCHASE_EVENT, refresh); };
  }, [open, items, selfId]);

  if (!open) return null;

  const pick = (prefab: Prefab) => {
    if (prefab.priceSwarm && !owned[prefab.id]) {
      setBuying(prefab);
      return;
    }
    if (getToolAny(prefab.id)) {
      onEquipTool?.(prefab.id);
      onClose();
      return;
    }
    builder.selectPrefab(prefab.id);
    onClose();
  };

  return (
    <div
      className={`pointer-events-none absolute inset-0 ${labOpen ? 'z-[60]' : 'z-30'} flex items-center justify-center p-3 animate-in fade-in duration-200`}
      data-testid="builder-inventory"
    >
      <div
        role="form"
        aria-label="Build inventory"
        className={[
          'pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-primary/30 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)]',
          // The Lab canvas needs more room; no backdrop blur there, so its
          // fullscreen mode can cover the whole viewport.
          labOpen
            ? 'max-h-[92vh] w-[min(98vw,1100px)] bg-background/95'
            : 'max-h-[76vh] w-[min(96vw,860px)] bg-background/55 backdrop-blur-md',
        ].join(' ')}
      >
        {/* Totals strip */}
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
          <Hammer className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {MATERIALS.map((m) => (
              <span
                key={m.id}
                data-testid={`material-total-${m.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[11px]"
                title={`${m.label}: ${totals[m.id]}`}
              >
                <span aria-hidden="true">{m.icon}</span>
                <span className="text-muted-foreground">{m.label}</span>
                <span className="font-semibold tabular-nums text-foreground">{totals[m.id]}</span>
              </span>
            ))}
          </div>
          <button
            type="button"
            aria-label="Exit Builder Mode"
            title="Exit Builder Mode"
            onClick={onExit ?? onClose}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Sections */}
          <div
            role="tablist"
            aria-label="Inventory sections"
            className="flex w-[132px] shrink-0 flex-col gap-1 border-r border-border/40 p-2"
          >
            {INVENTORY_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === section.id}
                data-testid={`inventory-section-${s.id}`}
                onClick={() => setSectionId(s.id)}
                className={[
                  'rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors',
                  s.id === section.id
                    ? 'bg-primary/20 font-semibold text-primary'
                    : 'text-muted-foreground hover:bg-muted/50',
                ].join(' ')}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Tiles */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {section.id === 'options' ? (
              <BuilderOptionsPanel builder={builder} selfId={selfId} projectId={projectId} projectName={projectName} />
            ) : section.id === 'lab' && labOpen ? (
              <LabTab embedded projectId={projectId} onBack={() => setLabOpen(false)} />
            ) : section.id === 'lab' ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2" data-testid="inventory-lab">
                <button
                  type="button"
                  onClick={() => setLabOpen(true)}
                  data-testid="inventory-lab-create"
                  title={`Open the Lab canvas to draw for ${projectId ? 'this project' : 'the Main Brain'}`}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/50 bg-primary/5 px-2 py-2.5 text-primary hover:border-primary hover:bg-primary/10"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/40">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="text-[12px] font-medium">Create in Lab</span>
                  <span className="text-[10px] text-primary/70">Draw with gathered materials</span>
                </button>
                {labItems.map((p) => (
                  <InventoryTile
                    key={p.id}
                    prefab={p}
                    totals={totals}
                    selected={builder.selectedPrefabId === p.id}
                    onPick={() => pick(p)}
                  />
                ))}
                {labItems.length === 0 && (
                  <div className="col-span-full px-2 py-4 text-center text-[12px] text-muted-foreground">
                    No Lab creations {projectId ? 'for this project' : 'in the Main Brain'} yet.
                  </div>
                )}
              </div>
            ) : section.id === 'gathered' ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                {MATERIALS.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-col items-center gap-1 rounded-xl border border-border/50 bg-muted/25 px-2 py-3"
                  >
                    <span className="text-2xl" aria-hidden="true">{m.icon}</span>
                    <span className="text-[12px] font-medium">{m.label}</span>
                    <span className="text-[13px] font-semibold tabular-nums text-primary">
                      {totals[m.id]}
                    </span>
                  </div>
                ))}
                {GATHERED_GOODS.map((g) => (
                  <div
                    key={g.id}
                    data-testid={`gathered-good-${g.id}`}
                    className="flex flex-col items-center gap-1 rounded-xl border border-border/50 bg-muted/25 px-2 py-3"
                  >
                    <span className="text-2xl" aria-hidden="true">{g.icon}</span>
                    <span className="text-[12px] font-medium">{g.label}</span>
                    <span className="text-[13px] font-semibold tabular-nums text-primary">{goods[g.id]}</span>
                  </div>
                ))}
                {COOKABLE_FOODS.filter((f) => cooked[f.cooked] > 0).map((f) => (
                  <div
                    key={f.cooked}
                    data-testid={`cooked-food-${f.cooked}`}
                    title={`Cooked on a fire pit · rows ${f.rowMetres} m`}
                    className="flex flex-col items-center gap-1 rounded-xl border border-border/50 bg-muted/25 px-2 py-3"
                  >
                    <span className="text-2xl" aria-hidden="true">{f.cookedIcon}</span>
                    <span className="text-[12px] font-medium">{f.label}</span>
                    <span className="text-[13px] font-semibold tabular-nums text-primary">{cooked[f.cooked]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
                {buying && (
                  <ToolPurchaseCard
                    prefab={buying}
                    userId={selfId}
                    onBought={() => { setOwned((o) => ({ ...o, [buying.id]: true })); setBuying(null); }}
                    onCancel={() => setBuying(null)}
                  />
                )}
                {items.map((p) => (
                  <InventoryTile
                    key={p.id}
                    prefab={p}
                    totals={totals}
                    selected={builder.selectedPrefabId === p.id}
                    owned={owned[p.id]}
                    onPick={() => pick(p)}
                  />
                ))}
                {items.length === 0 && (
                  <div className="col-span-full px-2 py-6 text-center text-[12px] text-muted-foreground">
                    Nothing in this section yet.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border/40 px-3 py-1.5 text-center text-[10px] text-muted-foreground">
          Pick an item to place a ghost · B or Esc to close
        </div>
      </div>
    </div>
  );
}

function InventoryTile({
  prefab,
  totals,
  selected,
  owned,
  onPick,
}: {
  prefab: Prefab;
  totals: Record<MaterialId, number>;
  selected: boolean;
  /** For a Market tool: whether this player has bought it. */
  owned?: boolean;
  onPick: () => void;
}) {
  const cost = useMemo(() => prefabCostFor(prefab), [prefab]);
  const priceLine = prefab.priceSwarm
    ? (owned ? 'Owned' : `${prefab.priceSwarm} SWARM or Credits`)
    : formatCost(cost);
  const afford = useMemo(() => checkAffordable(cost, totals), [cost, totals]);
  const missing = describeMissing(afford.missing);

  return (
    <button
      type="button"
      disabled={!afford.ok}
      onClick={onPick}
      data-testid={`inventory-tile-${prefab.id}`}
      data-affordable={afford.ok ? 'true' : 'false'}
      title={afford.ok ? `${prefab.label} — ${priceLine}` : `${prefab.label} — ${missing}`}
      className={[
        'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition-all',
        afford.ok
          ? 'border-border/60 bg-muted/30 hover:border-primary/60 hover:bg-primary/10'
          : 'cursor-not-allowed border-border/30 bg-muted/10 opacity-40',
        selected ? 'ring-2 ring-primary' : '',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className="h-9 w-9 rounded-md border border-white/15"
        style={{
          background: prefab.color,
          boxShadow: `0 0 14px -4px ${prefab.color}`,
        }}
      />
      <span className="w-full truncate text-[12px] font-medium">{prefab.label}</span>
      <span className="w-full text-[10px] leading-tight text-muted-foreground">
        {priceLine}
      </span>
      {!afford.ok && (
        <span className="w-full text-[9px] leading-tight text-amber-400/90">{missing}</span>
      )}
    </button>
  );
}
