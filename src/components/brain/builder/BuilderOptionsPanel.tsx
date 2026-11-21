/**
 * BuilderOptionsPanel — every builder toggle in one place.
 *
 * Extracted from `BrainBuilderBar` so the same controls can live inside
 * the transparent Build inventory panel (Options tab) instead of a
 * bottom bar pinned over the world.
 *
 * Pure UI lens: toggles flip existing stores (`landOverlayStore`,
 * `builderCameraStore`, `spectatorCameraStore`) and the `useBrainBuilder`
 * seam. Nothing here writes to the lattice.
 *
 * Performance: Stacked (default, full fidelity) or Light (bypasses every
 * user placement — meshes, colliders and HTML layers) for older devices.
 * The choice is saved locally (`builderRenderModeStore`).
 */
import { useEffect, useState } from 'react';
import {
  Magnet,
  Move3D,
  LandPlot as LandPlotIcon,
  Eye,
  Route,
  ArrowDownFromLine,
  Camera,
  Bug,
  UserRound,
  Layers,
  Feather,
  Gauge,
} from 'lucide-react';
import {
  setBuilderRenderMode,
  useBuilderRenderMode,
} from '@/lib/brain/builderRenderModeStore';
import {
  isOverheadView,
  isSeatDebugOn,
  subscribeSpectator,
  toggleOverheadView,
  toggleSeatDebug,
} from '@/lib/pub/spectatorCameraStore';
import {
  subscribeShowLandMarkers,
  getShowLandMarkers,
  toggleShowLandMarkers,
} from '@/lib/world/landOverlayStore';
import { isDev, grantDev } from '@/lib/world/devRoles';
import { BOX_PRICE_SWARM } from '@/lib/world/landPlots';
import {
  subscribeBuilderTopView,
  toggleBuilderTopView,
} from '@/lib/brain/builderCameraStore';
import type { UseBrainBuilder } from '@/lib/brain/useBrainBuilder';
import { BuilderDeviceOptions } from '@/components/brain/builder/BuilderDeviceOptions';
import {
  AVATAR_REGISTRY,
  loadHubPrefs,
  setActiveAvatarId,
  subscribeAvatarChange,
  DEFAULT_AVATAR_ID,
} from '@/lib/virtualHub/avatars';

interface BuilderOptionsPanelProps {
  builder: UseBrainBuilder;
  selfId?: string;
  /** Extra classes for the wrapper row. */
  className?: string;
}

export function BuilderOptionsPanel({
  builder,
  selfId,
  className = '',
}: BuilderOptionsPanelProps) {
  const {
    magnetic,
    setMagnetic,
    freeBuild,
    setFreeBuild,
    plotting,
    togglePlotting,
    plotMode,
    setPlotMode,
  } = builder;

  const [, forceSpec] = useState(0);
  useEffect(() => subscribeSpectator(() => forceSpec((n) => (n + 1) & 0xfff)), []);
  const overhead = isOverheadView();
  const seatDebug = isSeatDebugOn();

  const [topView, setTopView] = useState(false);
  useEffect(() => subscribeBuilderTopView(setTopView), []);
  const [showLand, setShowLand] = useState(() => getShowLandMarkers());
  useEffect(() => subscribeShowLandMarkers(setShowLand), []);
  const [canLayCommons, setCanLayCommons] = useState(() => isDev(selfId));
  useEffect(() => { setCanLayCommons(isDev(selfId)); }, [selfId]);

  const [avatarId, setAvatarId] = useState<string>(() => {
    try { return loadHubPrefs().avatarId || DEFAULT_AVATAR_ID; } catch { return DEFAULT_AVATAR_ID; }
  });
  useEffect(() => subscribeAvatarChange(setAvatarId), []);
  const renderMode = useBuilderRenderMode();

  return (
    <div className={`flex flex-col gap-2 ${className}`} data-testid="builder-options-panel">
      {/* Avatar — change your form without leaving the world */}
      <div className="rounded-lg border border-border/40 bg-muted/20 p-2">
        <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <UserRound className="h-3 w-3" aria-hidden="true" /> Avatar
        </div>
        <div className="flex flex-wrap gap-1.5">
          {AVATAR_REGISTRY.map((a) => {
            const active = a.id === avatarId;
            return (
              <button
                key={a.id}
                type="button"
                data-testid={`builder-avatar-${a.id}`}
                aria-pressed={active}
                disabled={!a.unlocked}
                title={a.description}
                onClick={() => setActiveAvatarId(a.id)}
                className={[
                  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] transition-colors disabled:opacity-50',
                  active
                    ? 'border-primary/60 bg-primary/15 text-primary'
                    : 'border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/70',
                ].join(' ')}
              >
                <span>{a.name}</span>
                <span className="opacity-60 tabular-nums">{(a.mass ?? 1.8).toFixed(1)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Performance — Stacked (full) vs Light (no user placements) */}
      <div className="rounded-lg border border-border/40 bg-muted/20 p-2" data-testid="builder-render-mode">
        <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Gauge className="h-3 w-3" aria-hidden="true" /> Performance
        </div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Builder render mode">
          <Chip
            testId="builder-mode-stacked"
            icon={<Layers className="h-3 w-3" aria-hidden="true" />}
            label="Stacked"
            title="Stacked — full fidelity: every placement, wall, interactive item and billboard"
            active={renderMode === 'stacked'}
            onClick={() => setBuilderRenderMode('stacked')}
          />
          <Chip
            testId="builder-mode-light"
            icon={<Feather className="h-3 w-3" aria-hidden="true" />}
            label="Light"
            title="Light — skip all user placements (meshes, colliders, billboards) so terrain, ocean, sky and avatars stay smooth on older devices"
            active={renderMode === 'light'}
            tone="emerald"
            onClick={() => setBuilderRenderMode('light')}
          />
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
          {renderMode === 'light'
            ? 'Light: user placements are hidden on this device, yours included. Saved for next time.'
            : 'Stacked: full detail. Switch to Light on older devices. Saved for next time.'}
        </p>
      </div>

      {/* Camera + microphone — switch inputs mid-call */}
      <BuilderDeviceOptions />

      <div className="flex flex-wrap items-center gap-1.5">

      <Chip
        testId="builder-toggle-magnetic"
        icon={<Magnet className="h-3 w-3" aria-hidden="true" />}
        label="Magnets"
        title="Magnets — stronger snap between assets"
        active={magnetic && !freeBuild}
        disabled={freeBuild}
        onClick={() => setMagnetic(!magnetic)}
      />
      <Chip
        testId="builder-toggle-freebuild"
        icon={<Move3D className="h-3 w-3" aria-hidden="true" />}
        label="Free"
        title="Free Build — drag and drop assets without grid snap"
        active={freeBuild}
        tone="amber"
        onClick={() => setFreeBuild(!freeBuild)}
      />
      {/* Private land is claimed block by block with the Boundary Marker
          (Tools). Walking a loop is kept only for maintainers laying
          public land (roads, squares). */}
      {canLayCommons && (
        <Chip
          testId="builder-toggle-plot"
          icon={<LandPlotIcon className="h-3 w-3" aria-hidden="true" />}
          label="Road survey"
          title="Road survey — walk a loop to lay free public land (roads, squares)"
          active={plotting}
          tone="amber"
          onClick={() => {
            if (plotMode !== 'commons') setPlotMode('commons');
            togglePlotting();
          }}
        />
      )}
      <Chip
        testId="builder-toggle-showland"
        icon={<Eye className="h-3 w-3" aria-hidden="true" />}
        label="Land"
        title="Show land — surface markers for owned and communal plots"
        active={showLand}
        tone="emerald"
        onClick={toggleShowLandMarkers}
      />
      {canLayCommons ? (
        <Chip
          testId="builder-toggle-commons"
          icon={<Route className="h-3 w-3" aria-hidden="true" />}
          label="Roads"
          title="Roads — lay free public land (roads, squares). Nobody can build on it."
          active={plotMode === 'commons'}
          onClick={() => {
            if (plotMode === 'commons') {
              setPlotMode('private');
              if (plotting) togglePlotting();
            } else {
              setPlotMode('commons');
            }
          }}
        />
      ) : (
        <Chip
          testId="builder-enable-roads"
          icon={<Route className="h-3 w-3" aria-hidden="true" />}
          label="Enable roads"
          title="Enable road laying (maintainer tools) on this device"
          active={false}
          onClick={() => { grantDev(selfId); setCanLayCommons(true); }}
        />
      )}
      <Chip
        testId="builder-toggle-topview"
        icon={<ArrowDownFromLine className="h-3 w-3" aria-hidden="true" />}
        label="Top"
        title="Top view — look down on your avatar and the build grid"
        active={topView}
        onClick={toggleBuilderTopView}
      />
      <Chip
        testId="builder-toggle-overhead"
        icon={<Camera className="h-3 w-3" aria-hidden="true" />}
        label="Overhead"
        title="Overhead view — spectator camera above the table"
        active={overhead}
        onClick={toggleOverheadView}
      />
      <Chip
        testId="builder-toggle-seatdebug"
        icon={<Bug className="h-3 w-3" aria-hidden="true" />}
        label="Seat debug"
        title="Seat debug — show seat anchors and occupancy read-out"
        active={seatDebug}
        onClick={toggleSeatDebug}
      />
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground" data-testid="builder-land-hint">
        Claim land: pick up the Boundary Marker from Tools, then press and hold a grid block
        ({BOX_PRICE_SWARM} SWARM per block).
      </p>
    </div>

  );
}

function Chip({
  testId,
  icon,
  label,
  title,
  active,
  disabled = false,
  tone = 'primary',
  onClick,
}: {
  testId: string;
  icon: React.ReactNode;
  label: string;
  title: string;
  active: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'amber' | 'emerald';
  onClick: () => void;
}) {
  const activeClass =
    tone === 'amber'
      ? 'border-amber-400/70 bg-amber-400/15 text-amber-300'
      : tone === 'emerald'
        ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-300'
        : 'border-primary/60 bg-primary/15 text-primary';
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      title={title}
      className={[
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] transition-colors disabled:opacity-50',
        active ? activeClass : 'border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/70',
      ].join(' ')}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
