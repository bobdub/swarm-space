/**
 * useBrainBuilder — light React state seam for the Brain Builder Bar.
 *
 * Owns: { mode, magnetic, selectedPrefabId, selectedBlockId }.
 * Emits: `brain-builder-mode` CustomEvent on every mode change so the
 * scene can suppress the joystick / mini-map / run pill and zero the
 * avatar intent vector while keeping mic / camera / chat alive.
 *
 * INVARIANT — this hook never touches the field, the physics engine, or
 * the pin template directly. Commits flow through
 * `getBuilderBlockEngine().placeBlock(...)` (wired in a follow-up). For
 * now the hook only exposes intent so the UI can scaffold cleanly.
 */
import { useCallback, useEffect, useState } from 'react';
import type { PrefabSectionId } from '@/lib/brain/prefabHouseCatalog';
import type { PlotCellRect } from '@/lib/world/landPlots';

export type BuilderMode = 'off' | 'build';

export const BUILDER_MODE_EVENT = 'brain-builder-mode';

export interface BuilderModeEventDetail {
  mode: BuilderMode;
  magnetic: boolean;
  freeBuild: boolean;
  plotting: boolean;
}

/** Snapshot of a closed-but-unconfirmed plot survey. */
export interface PendingPlot {
  rect: PlotCellRect;
  priceSwarm: number;
  boxes: number;
  widthM: number;
  depthM: number;
}

export interface UseBrainBuilder {
  mode: BuilderMode;
  magnetic: boolean;
  freeBuild: boolean;
  plotting: boolean;
  pendingPlot: PendingPlot | null;
  activeSection: PrefabSectionId;
  selectedPrefabId: string | null;
  selectedBlockId: string | null;
  enterBuild: () => void;
  exitBuild: () => void;
  toggleMode: () => void;
  setMagnetic: (next: boolean) => void;
  setFreeBuild: (next: boolean) => void;
  setPlotting: (next: boolean) => void;
  togglePlotting: () => void;
  setPendingPlot: (p: PendingPlot | null) => void;
  setActiveSection: (section: PrefabSectionId) => void;
  selectPrefab: (id: string | null) => void;
  selectBlock: (id: string | null) => void;
}

function emit(mode: BuilderMode, magnetic: boolean, freeBuild: boolean, plotting: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<BuilderModeEventDetail>(BUILDER_MODE_EVENT, {
      detail: { mode, magnetic, freeBuild, plotting },
    }),
  );
}

export function useBrainBuilder(): UseBrainBuilder {
  const [mode, setMode] = useState<BuilderMode>('off');
  const [magnetic, setMagneticState] = useState<boolean>(true);
  const [freeBuild, setFreeBuildState] = useState<boolean>(false);
  const [plotting, setPlottingState] = useState<boolean>(false);
  const [pendingPlot, setPendingPlotState] = useState<PendingPlot | null>(null);
  const [activeSection, setActiveSection] = useState<PrefabSectionId>('walls');
  const [selectedPrefabId, setSelectedPrefabId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  useEffect(() => {
    emit(mode, magnetic, freeBuild, plotting);
  }, [mode, magnetic, freeBuild, plotting]);

  const enterBuild = useCallback(() => setMode('build'), []);
  const exitBuild = useCallback(() => {
    setMode('off');
    setPlottingState(false);
    setPendingPlotState(null);
  }, []);
  const toggleMode = useCallback(
    () => setMode((m) => (m === 'build' ? 'off' : 'build')),
    [],
  );
  const setMagnetic = useCallback((next: boolean) => setMagneticState(next), []);
  const setFreeBuild = useCallback((next: boolean) => {
    setFreeBuildState(next);
    // Free Build implies snap off; the resolver short-circuits to grid.
    if (next) setMagneticState(false);
  }, []);
  const setPlotting = useCallback((next: boolean) => {
    setPlottingState(next);
    // Switching off plotting cancels any pending claim.
    if (!next) setPendingPlotState(null);
    // Drop any armed prefab when entering plot mode so the ghost vanishes.
    if (next) setSelectedPrefabId(null);
  }, []);
  const togglePlotting = useCallback(() => {
    setPlottingState((v) => {
      const next = !v;
      if (!next) setPendingPlotState(null);
      if (next) setSelectedPrefabId(null);
      return next;
    });
  }, []);
  const setPendingPlot = useCallback((p: PendingPlot | null) => setPendingPlotState(p), []);
  const selectPrefab = useCallback((id: string | null) => setSelectedPrefabId(id), []);
  const selectBlock = useCallback((id: string | null) => setSelectedBlockId(id), []);

  return {
    mode,
    magnetic,
    freeBuild,
    plotting,
    pendingPlot,
    activeSection,
    selectedPrefabId,
    selectedBlockId,
    enterBuild,
    exitBuild,
    toggleMode,
    setMagnetic,
    setFreeBuild,
    setPlotting,
    togglePlotting,
    setPendingPlot,
    setActiveSection,
    selectPrefab,
    selectBlock,
  };
}