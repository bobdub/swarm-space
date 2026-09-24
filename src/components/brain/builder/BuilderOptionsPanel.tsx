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
} from 'lucide-react';
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
import {
  subscribeBuilderTopView,
  toggleBuilderTopView,
} from '@/lib/brain/builderCameraStore';
import type { UseBrainBuilder } from '@/lib/brain/useBrainBuilder';
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
      <Chip
        testId="builder-toggle-plot"
        icon={<LandPlotIcon className="h-3 w-3" aria-hidden="true" />}
        label="Plot"
        title="Plot — walk a loop to claim land (3 SWARM per box)"
        active={plotting}
        tone="amber"
        onClick={togglePlotting}
      />
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
          onClick={() => setPlotMode(plotMode === 'commons' ? 'private' : 'commons')}
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
