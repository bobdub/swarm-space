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

export type BuilderMode = 'off' | 'build';

export const BUILDER_MODE_EVENT = 'brain-builder-mode';

export interface BuilderModeEventDetail {
  mode: BuilderMode;
  magnetic: boolean;
  freeBuild: boolean;
}

export interface UseBrainBuilder {
  mode: BuilderMode;
  magnetic: boolean;
  freeBuild: boolean;
  activeSection: PrefabSectionId;
  selectedPrefabId: string | null;
  selectedBlockId: string | null;
  enterBuild: () => void;
  exitBuild: () => void;
  toggleMode: () => void;
  setMagnetic: (next: boolean) => void;
  setFreeBuild: (next: boolean) => void;
  setActiveSection: (section: PrefabSectionId) => void;
  selectPrefab: (id: string | null) => void;
  selectBlock: (id: string | null) => void;
}

function emit(mode: BuilderMode, magnetic: boolean, freeBuild: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<BuilderModeEventDetail>(BUILDER_MODE_EVENT, {
      detail: { mode, magnetic, freeBuild },
    }),
  );
}

export function useBrainBuilder(): UseBrainBuilder {
  const [mode, setMode] = useState<BuilderMode>('off');
  const [magnetic, setMagneticState] = useState<boolean>(true);
  const [freeBuild, setFreeBuildState] = useState<boolean>(false);
  const [activeSection, setActiveSection] = useState<PrefabSectionId>('walls');
  const [selectedPrefabId, setSelectedPrefabId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  useEffect(() => {
    emit(mode, magnetic, freeBuild);
  }, [mode, magnetic, freeBuild]);

  const enterBuild = useCallback(() => setMode('build'), []);
  const exitBuild = useCallback(() => {
    setMode('off');
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
  const selectPrefab = useCallback((id: string | null) => setSelectedPrefabId(id), []);
  const selectBlock = useCallback((id: string | null) => setSelectedBlockId(id), []);

  return {
    mode,
    magnetic,
    freeBuild,
    activeSection,
    selectedPrefabId,
    selectedBlockId,
    enterBuild,
    exitBuild,
    toggleMode,
    setMagnetic,
    setFreeBuild,
    setActiveSection,
    selectPrefab,
    selectBlock,
  };
}