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
}

export interface UseBrainBuilder {
  mode: BuilderMode;
  magnetic: boolean;
  activeSection: PrefabSectionId;
  selectedPrefabId: string | null;
  selectedBlockId: string | null;
  enterBuild: () => void;
  exitBuild: () => void;
  toggleMode: () => void;
  setMagnetic: (next: boolean) => void;
  setActiveSection: (section: PrefabSectionId) => void;
  selectPrefab: (id: string | null) => void;
  selectBlock: (id: string | null) => void;
}

function emit(mode: BuilderMode, magnetic: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<BuilderModeEventDetail>(BUILDER_MODE_EVENT, {
      detail: { mode, magnetic },
    }),
  );
}

export function useBrainBuilder(): UseBrainBuilder {
  const [mode, setMode] = useState<BuilderMode>('off');
  const [magnetic, setMagneticState] = useState<boolean>(true);
  const [activeSection, setActiveSection] = useState<PrefabSectionId>('walls');
  const [selectedPrefabId, setSelectedPrefabId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  useEffect(() => {
    emit(mode, magnetic);
  }, [mode, magnetic]);

  const enterBuild = useCallback(() => setMode('build'), []);
  const exitBuild = useCallback(() => {
    setMode('off');
    setSelectedPrefabId(null);
  }, []);
  const toggleMode = useCallback(
    () => setMode((m) => (m === 'build' ? 'off' : 'build')),
    [],
  );
  const setMagnetic = useCallback((next: boolean) => setMagneticState(next), []);
  const selectPrefab = useCallback((id: string | null) => setSelectedPrefabId(id), []);
  const selectBlock = useCallback((id: string | null) => setSelectedBlockId(id), []);

  return {
    mode,
    magnetic,
    activeSection,
    selectedPrefabId,
    selectedBlockId,
    enterBuild,
    exitBuild,
    toggleMode,
    setMagnetic,
    setActiveSection,
    selectPrefab,
    selectBlock,
  };
}