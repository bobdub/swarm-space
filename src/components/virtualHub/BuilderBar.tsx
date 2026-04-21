import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RotateCcw, RotateCw, Trash2, X, Magnet } from "lucide-react";
import { HOUSE_PREFAB } from "@/lib/virtualHub/builderCatalog";
import { getCompound } from "@/lib/virtualHub/compoundCatalog";
import type { HubPieceKind, HubPieceSection } from "@/types";
import type { BuildController } from "./useBuildController";

interface BuilderBarProps {
  controller: BuildController;
  /** Spawn position 2 m in front of the camera. */
  getSpawn: () => { x: number; z: number };
}

export function BuilderBar({ controller, getSpawn }: BuilderBarProps) {
  const [section, setSection] = useState<HubPieceSection>("walls");
  const prefab = HOUSE_PREFAB;
  const items = prefab.sections.find((s) => s.id === section)?.items ?? [];

  const handlePlace = (kind: HubPieceKind) => {
    controller.placePiece(kind, getSpawn());
  };

  return (
    <div
      data-hub-ui
      className="absolute bottom-0 left-0 right-0 z-20 border-t border-border/40 bg-background/85 backdrop-blur-md p-3 sm:p-4"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Prefab:</span>
            <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
              {prefab.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1">
              <Magnet className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Snap</span>
              <Switch
                checked={controller.magnetic}
                onCheckedChange={controller.setMagnetic}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={controller.exitBuild}
              className="gap-1"
            >
              <X className="h-4 w-4" /> Exit
            </Button>
          </div>
        </div>

        <Tabs value={section} onValueChange={(v) => setSection(v as HubPieceSection)}>
          <TabsList className="w-full justify-start overflow-x-auto">
            {prefab.sections.map((s) => (
              <TabsTrigger key={s.id} value={s.id} className="capitalize">
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {items.map((item) => {
            const compound = getCompound(item.kind);
            return (
              <button
                key={item.kind}
                type="button"
                onClick={() => handlePlace(item.kind)}
                title={`${compound.name} — ${compound.formula}`}
                className="flex min-w-[92px] flex-col items-center gap-1 rounded-lg border border-border/50 bg-card/60 px-2 py-2 text-foreground transition hover:border-primary hover:bg-primary/10"
              >
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-sm border border-border/40"
                  style={{ backgroundColor: compound.color }}
                />
                <span className="text-[11px] font-medium leading-tight">{item.label}</span>
                <span className="font-mono text-[10px] leading-tight text-muted-foreground">
                  {compound.formula}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {controller.selectedId
              ? "Drag piece to move · use controls →"
              : "Tap a piece in the world to select it"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!controller.selectedId}
              onClick={() => controller.selectedId && controller.rotatePiece(controller.selectedId, -1)}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!controller.selectedId}
              onClick={() => controller.selectedId && controller.rotatePiece(controller.selectedId, 1)}
            >
              <RotateCw className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!controller.selectedId}
              onClick={() => controller.selectedId && controller.deletePiece(controller.selectedId)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}