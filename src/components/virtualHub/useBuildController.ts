import { useCallback, useEffect, useRef, useState } from "react";
import type { HubPiece, HubPieceKind, Project } from "@/types";
import { getBuilderItem, sectionForKind } from "@/lib/virtualHub/builderCatalog";
import { findSnap } from "@/lib/virtualHub/snapping";
import { updateProject } from "@/lib/projects";

export type BuildMode = "walk" | "build";

export interface BuildControllerOptions {
  project: Project | null;
  currentUserId: string | null;
  canEdit: boolean;
  onProjectChange: (project: Project) => void;
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `piece-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useBuildController({
  project,
  currentUserId,
  canEdit,
  onProjectChange,
}: BuildControllerOptions) {
  const [mode, setMode] = useState<BuildMode>("walk");
  const [pieces, setPieces] = useState<HubPiece[]>(project?.hubBuild?.pieces ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [magnetic, setMagnetic] = useState(true);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;

  // Hydrate from project when it loads / changes id.
  useEffect(() => {
    setPieces(project?.hubBuild?.pieces ?? []);
    setSelectedId(null);
  }, [project?.id]);

  // Debounced persistence
  const saveTimer = useRef<number | null>(null);
  const schedulePersist = useCallback(
    (next: HubPiece[]) => {
      if (!project || !canEdit) return;
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
      }
      saveTimer.current = window.setTimeout(async () => {
        try {
          const updated = await updateProject(project.id, { hubBuild: { pieces: next } });
          if (updated) onProjectChange(updated);
        } catch (err) {
          console.warn("[BuildController] save failed", err);
        }
      }, 1000);
    },
    [project, canEdit, onProjectChange],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const mutate = useCallback(
    (next: HubPiece[]) => {
      setPieces(next);
      schedulePersist(next);
    },
    [schedulePersist],
  );

  const enterBuild = useCallback(() => {
    if (!canEdit) return;
    setMode("build");
  }, [canEdit]);

  const exitBuild = useCallback(() => {
    setMode("walk");
    setSelectedId(null);
  }, []);

  const placePiece = useCallback(
    (kind: HubPieceKind, spawnXZ: { x: number; z: number }) => {
      if (!canEdit) return;
      const item = getBuilderItem(kind);
      if (!item) return;
      const piece: HubPiece = {
        id: genId(),
        kind,
        section: sectionForKind(kind),
        position: [spawnXZ.x, item.yCentre, spawnXZ.z],
        rotationY: 0,
        placedBy: currentUserId ?? "anonymous",
        placedAt: Date.now(),
      };
      const next = [...piecesRef.current, piece];
      mutate(next);
      setSelectedId(piece.id);
    },
    [canEdit, currentUserId, mutate],
  );

  const movePiece = useCallback(
    (id: string, worldXZ: { x: number; z: number }) => {
      const current = piecesRef.current;
      const target = current.find((p) => p.id === id);
      if (!target) return;
      let nextX = worldXZ.x;
      let nextZ = worldXZ.z;
      const item = getBuilderItem(target.kind);
      const y = item?.yCentre ?? target.position[1];
      const candidate: HubPiece = {
        ...target,
        position: [nextX, y, nextZ],
      };
      if (magnetic) {
        const snap = findSnap(candidate, current, 0.4);
        if (snap) {
          nextX += snap.dx;
          nextZ += snap.dz;
        }
      }
      const next = current.map((p) =>
        p.id === id ? { ...p, position: [nextX, y, nextZ] as [number, number, number] } : p,
      );
      mutate(next);
    },
    [magnetic, mutate],
  );

  const rotatePiece = useCallback(
    (id: string, dir: 1 | -1) => {
      const next = piecesRef.current.map((p) =>
        p.id === id ? { ...p, rotationY: p.rotationY + (dir * Math.PI) / 2 } : p,
      );
      mutate(next);
    },
    [mutate],
  );

  const deletePiece = useCallback(
    (id: string) => {
      const next = piecesRef.current.filter((p) => p.id !== id);
      mutate(next);
      setSelectedId((current) => (current === id ? null : current));
    },
    [mutate],
  );

  return {
    mode,
    enterBuild,
    exitBuild,
    pieces,
    selectedId,
    setSelectedId,
    magnetic,
    setMagnetic,
    placePiece,
    movePiece,
    rotatePiece,
    deletePiece,
  };
}

export type BuildController = ReturnType<typeof useBuildController>;