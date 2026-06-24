/**
 * BrainBuilderBar — Sims-style dock for placing UQRC prefabs.
 *
 * UQRC display:
 *   • Swatch     = compound color blended from real element colors.
 *   • Tooltip    = mass, water-resistance, flammability, shell tags.
 *   • Magnetic   = toggle (default ON); meaning "minimize ‖[D_μ,D_ν]‖".
 *
 * Lab section: a virtual tab that mirrors `mintedPrefabsStore` for the
 * current project. The first tile is "+ Create New" and routes to the
 * Lab with the project pre-wired; the rest render as normal PrefabTiles.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Magnet, FlaskConical, Plus, Move3D, LandPlot, Footprints } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  PREFAB_SECTIONS,
  listPrefabsBySection,
  type PrefabSectionId,
  type Prefab,
} from '@/lib/brain/prefabHouseCatalog';
import { classifySize, SIZE_TIER_META } from '@/lib/brain/assetSizing';
import type { UseBrainBuilder } from '@/lib/brain/useBrainBuilder';
import {
  subscribeMintedPrefabs,
  type MintedRecord,
} from '@/lib/remix/mintedPrefabsStore';

/** Virtual section id — not present in PREFAB_SECTIONS. */
const LAB_SECTION = 'lab' as const;
type BarSectionId = PrefabSectionId | typeof LAB_SECTION;

interface BrainBuilderBarProps {
  builder: UseBrainBuilder;
  /** Project the bar is operating within, if any. */
  projectId?: string | null;
  /** Called when the user confirms a closed plot survey. */
  onConfirmPlot?: () => void;
  /** SWARM balance (display only). null means "unknown". */
  swarmBalance?: number | null;
}

export function BrainBuilderBar({
  builder,
  projectId = null,
  onConfirmPlot,
  swarmBalance = null,
}: BrainBuilderBarProps) {
  const {
    magnetic,
    setMagnetic,
    freeBuild,
    setFreeBuild,
    plotting,
    togglePlotting,
    pendingPlot,
    setPendingPlot,
    activeSection,
    setActiveSection,
    selectedPrefabId,
    selectPrefab,
    exitBuild,
  } = builder;
  const navigate = useNavigate();

  /** Local override — when 'lab' is picked, override the section list. */
  const [labOpen, setLabOpen] = useState(false);
  const currentTab: BarSectionId = labOpen ? LAB_SECTION : activeSection;

  const [mints, setMints] = useState<MintedRecord[]>([]);
  useEffect(() => subscribeMintedPrefabs(setMints), []);

  const labItems = useMemo(
    () => (projectId ? mints.filter((r) => r.projectId === projectId) : mints),
    [mints, projectId],
  );

  const items = useMemo(() => listPrefabsBySection(activeSection), [activeSection]);

  const openLab = () => {
    const url = projectId ? `/remix?projectId=${encodeURIComponent(projectId)}` : '/remix';
    navigate(url);
  };

  // While actively walking a survey (no pending plot yet), hide the
  // entire bar so the world is fully walkable.
  if (plotting && !pendingPlot) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[max(env(safe-area-inset-bottom),16px)]">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-400/60 bg-background/85 px-3 py-1.5 text-[11px] text-amber-300 shadow-lg backdrop-blur">
          <Footprints className="h-3.5 w-3.5" />
          <span>Plotting — walk back to your start to close the loop</span>
          <button
            type="button"
            onClick={togglePlotting}
            className="ml-2 rounded-full border border-amber-400/50 px-2 py-0.5 text-[10px] uppercase tracking-wide hover:bg-amber-400/15"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (pendingPlot) {
    const shortfall = swarmBalance != null ? Math.max(0, pendingPlot.priceSwarm - swarmBalance) : 0;
    const canAfford = swarmBalance == null || swarmBalance >= pendingPlot.priceSwarm;
    return (
      <div
        role="form"
        aria-label="Confirm Plot"
        className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t border-amber-400/60 bg-background/90 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 backdrop-blur-md shadow-[0_-8px_32px_-12px_rgba(251,191,36,0.45)]"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-300">
            <LandPlot className="h-4 w-4" />
            <span className="text-sm font-semibold">Claim Land Plot</span>
          </div>
          <Button type="button" size="icon" variant="ghost" aria-label="Cancel plot" onClick={() => setPendingPlot(null)} className="h-7 w-7">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <Stat label="Size" value={`${pendingPlot.widthM.toFixed(1)} × ${pendingPlot.depthM.toFixed(1)} m`} />
          <Stat label="Boxes" value={`${pendingPlot.boxes}`} />
          <Stat label="Cost" value={`${pendingPlot.priceSwarm} SWARM`} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground">
            {swarmBalance != null ? (
              canAfford ? (
                <>Balance: <span className="text-foreground">{swarmBalance.toFixed(2)} SWARM</span></>
              ) : (
                <span className="text-red-400">Need {shortfall.toFixed(2)} more SWARM</span>
              )
            ) : (
              <span>Balance unavailable</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPendingPlot(null)}
              className="rounded-full border border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirmPlot?.()}
              disabled={!canAfford}
              className="rounded-full border border-amber-400/70 bg-amber-400/20 px-4 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Confirm Plot
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="form"
      aria-label="Brain Builder Bar"
      className={[
        'pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t bg-background/85 px-3 pb-[max(env(safe-area-inset-bottom),16px)] pt-2 backdrop-blur-md transition-colors',
        freeBuild ? 'border-amber-400/60 shadow-[0_0_24px_-8px_rgba(251,191,36,0.45)]' : 'border-border/40',
      ].join(' ')}
    >
      {/* Top row — prefab label + exit */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-medium text-primary">
            {currentTab === LAB_SECTION ? 'Lab' : 'House'}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {currentTab === LAB_SECTION ? 'Project mints' : 'UQRC prefabs'}
          </span>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Exit Builder Mode"
          onClick={exitBuild}
          className="h-7 w-7 shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Toggle row — always visible, wraps on narrow viewports */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="builder-toggle-magnetic"
          onClick={() => setMagnetic(!magnetic)}
          aria-pressed={magnetic}
          disabled={freeBuild}
          title="Magnets — stronger snap between assets"
          className={[
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50',
            magnetic && !freeBuild
              ? 'border-primary/60 bg-primary/15 text-primary'
              : 'border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/70',
          ].join(' ')}
        >
          <Magnet className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Magnets</span>
        </button>
        <button
          type="button"
          data-testid="builder-toggle-freebuild"
          onClick={() => setFreeBuild(!freeBuild)}
          aria-pressed={freeBuild}
          title="Free Build — drag and drop assets without grid snap"
          className={[
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
            freeBuild
              ? 'border-amber-400/70 bg-amber-400/15 text-amber-300'
              : 'border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/70',
          ].join(' ')}
        >
          <Move3D className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Free Build</span>
        </button>
        <button
          type="button"
          data-testid="builder-toggle-plot"
          onClick={togglePlotting}
          aria-pressed={plotting}
          title="Plot — walk a loop to claim land (3 SWARM per box)"
          className={[
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
            plotting
              ? 'border-amber-400/70 bg-amber-400/15 text-amber-300'
              : 'border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/70',
          ].join(' ')}
        >
          <LandPlot className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Plot</span>
        </button>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Prefab sections">
        {PREFAB_SECTIONS.map((s) => (
          <SectionTab
            key={s.id}
            id={s.id}
            label={s.label}
            active={!labOpen && activeSection === s.id}
            onSelect={() => { setLabOpen(false); setActiveSection(s.id); }}
          />
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={labOpen}
          onClick={() => setLabOpen(true)}
          className={[
            'whitespace-nowrap rounded-full px-3 py-1 text-[11px] transition-colors inline-flex items-center gap-1',
            labOpen
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/40 text-muted-foreground hover:bg-muted/70',
          ].join(' ')}
          data-section-id={LAB_SECTION}
        >
          <FlaskConical className="h-3 w-3" /> Lab
        </button>
      </div>

      {/* Asset tiles */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {currentTab === LAB_SECTION ? (
          <>
            <CreateNewLabTile onClick={openLab} />
            {labItems.map((rec) => (
              <PrefabTile
                key={rec.id}
                prefab={rec.prefab}
                selected={selectedPrefabId === rec.prefab.id}
                onSelect={() => selectPrefab(selectedPrefabId === rec.prefab.id ? null : rec.prefab.id)}
              />
            ))}
            {labItems.length === 0 && (
              <div className="px-2 py-3 text-[11px] text-muted-foreground">
                No Lab creations{projectId ? ' for this project' : ''} yet.
              </div>
            )}
          </>
        ) : (
          <>
            {items.map((p) => (
              <PrefabTile
                key={p.id}
                prefab={p}
                selected={selectedPrefabId === p.id}
                onSelect={() => selectPrefab(selectedPrefabId === p.id ? null : p.id)}
              />
            ))}
            {items.length === 0 && (
              <div className="px-2 py-3 text-[11px] text-muted-foreground">
                No prefabs in this section yet.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/60 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-[12px] font-semibold text-foreground/90">{value}</div>
    </div>
  );
}

function CreateNewLabTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open the Lab to mint a new asset"
      aria-label="Create new Lab asset"
      className="flex min-w-[72px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-primary/50 bg-primary/5 px-2 py-1.5 text-primary transition-all hover:border-primary hover:bg-primary/10"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-primary/40">
        <Plus className="h-4 w-4" />
      </span>
      <span className="text-[10px] font-medium">Create</span>
      <span className="text-[9px] text-primary/70">in Lab</span>
    </button>
  );
}

function SectionTab({
  id,
  label,
  active,
  onSelect,
}: {
  id: PrefabSectionId;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={[
        'whitespace-nowrap rounded-full px-3 py-1 text-[11px] transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted/40 text-muted-foreground hover:bg-muted/70',
      ].join(' ')}
      data-section-id={id}
    >
      {label}
    </button>
  );
}

function PrefabTile({
  prefab,
  selected,
  onSelect,
}: {
  prefab: Prefab;
  selected: boolean;
  onSelect: () => void;
}) {
  const tier = classifySize({
    width: prefab.width, depth: prefab.depth, height: prefab.height,
    mass: prefab.mass,
    natureHint: prefab.sectionId === 'consumables' ? false : undefined,
  });
  const tierMeta = SIZE_TIER_META[tier];
  const tooltip = [
    `${prefab.label} — ${prefab.formula}`,
    `${tierMeta.label} · ${prefab.width.toFixed(2)}×${prefab.depth.toFixed(2)}×${prefab.height.toFixed(2)} m`,
    `mass ${prefab.mass.toFixed(0)} kg`,
    `H₂O resist ${(prefab.waterResistance * 100).toFixed(0)}%`,
    `flammable ${(prefab.flammability * 100).toFixed(0)}%`,
    `shells n=${prefab.shellTags.join(',')}`,
  ].join(' · ');

  return (
    <button
      type="button"
      onClick={onSelect}
      title={tooltip}
      aria-pressed={selected}
      className={[
        'flex min-w-[72px] flex-col items-center gap-1 rounded-md border px-2 py-1.5 transition-all',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border/50 bg-background/60 hover:border-border',
      ].join(' ')}
    >
      <span
        className="h-7 w-7 rounded-sm border border-border/40"
        style={{ backgroundColor: prefab.color }}
        aria-hidden="true"
      />
      <span className="max-w-[80px] truncate text-[10px] font-medium text-foreground/90">
        {prefab.label}
      </span>
      <span className="text-[9px] text-muted-foreground">{prefab.formula}</span>
      <span
        className="rounded-full bg-muted/40 px-1.5 py-[1px] text-[8px] uppercase tracking-wider text-muted-foreground"
        title={`${tierMeta.label} sized asset`}
      >
        {tierMeta.glyph} {tierMeta.label}
      </span>
    </button>
  );
}

export default BrainBuilderBar;