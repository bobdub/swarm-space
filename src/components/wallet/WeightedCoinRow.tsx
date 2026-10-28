import { Stamp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WEIGHTED_COIN_LABEL } from "@/lib/blockchain/weightedCoin";

/** Sealed Creator Proof coins, listed under the SWARM row. */
export function WeightedCoinRow({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={WEIGHTED_COIN_LABEL} className="rounded-full p-0.5 text-primary">
                  <Stamp className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{WEIGHTED_COIN_LABEL}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          SWARM
          <span className="text-xs text-muted-foreground">Sealed · Creator Proof</span>
        </div>
        <div className="text-xl font-semibold tabular-nums">
          {count.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">sealed coin{count === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
