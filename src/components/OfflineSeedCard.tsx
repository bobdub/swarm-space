import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { Project } from "@/types";
import {
  hydrateHarvestedInventory,
  listOfflineHarvested,
  listSeededHarvested,
  subscribeHarvested,
} from "@/lib/remix/harvestedInventory";
import { foldMaterialTotals, GATHERED_GOODS, MATERIALS } from "@/lib/world/materials";
import {
  PROJECT_SEED_FEE_SWARM,
  seedProjectWithOfflineGathers,
  seedRefusal,
} from "@/lib/world/offlineProjectSeed";

/** "Wood 4 · Honey 2", from a list of bag entries. */
function describeBag(parts: { symbol: string; count: number }[]): string {
  const materials = foldMaterialTotals(parts);
  const out: string[] = [];
  for (const m of MATERIALS) if (materials[m.id] > 0) out.push(`${m.label} ${materials[m.id]}`);
  for (const g of GATHERED_GOODS) {
    const n = Math.floor(parts.find((p) => p.symbol === `good:${g.id}`)?.count ?? 0);
    if (n > 0) out.push(`${g.label} ${n}`);
  }
  return out.join(" · ");
}

interface Props {
  project: Project;
  userId: string;
}

/**
 * Lets a project's creator start an empty project with what they gathered
 * in offline play, for a SWARM fee (see `offlineProjectSeed.ts`).
 */
export function OfflineSeedCard({ project, userId }: Props) {
  const [offline, setOffline] = useState(() => listOfflineHarvested());
  const [seeded, setSeeded] = useState(() => listSeededHarvested(project.id));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The bag may not have loaded yet when Settings is opened outside the Brain.
    void hydrateHarvestedInventory();
    return subscribeHarvested(() => {
      setOffline(listOfflineHarvested());
      setSeeded(listSeededHarvested(project.id));
    });
  }, [project.id]);

  const offlineText = useMemo(() => describeBag(offline), [offline]);
  const seededText = useMemo(() => describeBag(seeded), [seeded]);
  const refusal = seedRefusal(project, userId, offline.length);

  const handleSeed = async () => {
    if (busy || refusal) return;
    setBusy(true);
    try {
      const result = await seedProjectWithOfflineGathers(project.id, userId);
      toast({
        title: "Project seeded",
        description: `${describeBag(result.moved) || "Your offline gathers"} moved into ${project.name} for ${result.fee} SWARM.`,
      });
    } catch (error) {
      toast({
        title: "Nothing was moved",
        description: error instanceof Error ? error.message : "Unable to seed the project",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)] p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold uppercase tracking-[0.2em]">Offline gathers</h2>
        <p className="text-sm text-foreground/60">
          Goods you gather while offline stay in local play and never sync or trade. While this project has no
          members, you can start it with them for {PROJECT_SEED_FEE_SWARM} SWARM. They can then be used in this
          project's Brain only, and are never sold or crafted into coins.
        </p>
      </header>

      <div className="space-y-1 text-sm">
        <p>
          <span className="text-foreground/60">Held offline: </span>
          {offlineText || "nothing"}
        </p>
        {seededText && (
          <p>
            <span className="text-foreground/60">Already in this project: </span>
            {seededText}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-foreground/50">{refusal ?? `Moves everything held offline into ${project.name}.`}</p>
        <Button onClick={handleSeed} disabled={Boolean(refusal) || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Seed project (${PROJECT_SEED_FEE_SWARM} SWARM)`}
        </Button>
      </div>
    </Card>
  );
}
