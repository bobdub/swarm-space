import { Activity } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppHealth } from "@/hooks/useAppHealth";
import { useChainBridgeStatus } from "@/hooks/useChainBridgeStatus";
import { useUqrcClosure } from "@/hooks/useUqrcClosure";
import { cn } from "@/lib/utils";

/**
 * AppHealthBadge — single chip surfacing the App Q_Score derived from the
 * shared UQRC field. Replaces five independent health dashboards with one
 * coherent view; clicking opens the top hotspots/coldspots.
 */
export function AppHealthBadge() {
  const health = useAppHealth();
  const chain = useChainBridgeStatus();
  const closure = useUqrcClosure();

  const tipAgeLabel = chain.pinnedAt
    ? `${Math.max(0, Math.round(chain.pinAgeMs / 1000))}s`
    : "—";
  const tipShort = chain.pinnedHash
    ? `${chain.pinnedHash.slice(0, 6)}…${chain.pinnedHash.slice(-4)}`
    : "—";

  const dotClass =
    health.qScore < 0.05
      ? "bg-emerald-400"
      : health.qScore < 0.2
        ? "bg-amber-400"
        : "bg-destructive";

  const trendIcon =
    health.trend === "heating" ? "↑" : health.trend === "cooling" ? "↓" : "·";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Application health: Q=${health.qScore.toFixed(4)}, ${health.basins} basins, λ=${health.lambda.toFixed(1)}`}
          className="hidden md:flex items-center gap-2 h-9 px-3 rounded-full border border-border/40 bg-background/40 text-xs font-mono hover:bg-primary/10 transition-colors"
        >
          <span className={cn("h-2 w-2 rounded-full", dotClass)} aria-hidden />
          <Activity className="h-3.5 w-3.5 text-secondary" aria-hidden />
          <span>Q {health.qScore.toFixed(4)}</span>
          <span className="text-foreground/50">· {health.basins}b</span>
          <span className="text-foreground/50">
            · λ {health.lambda.toFixed(1)} {trendIcon}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-foreground/60">
            App Q_Score
          </p>
          <p className="font-mono text-sm">
            Q = {health.qScore.toFixed(6)} · trend {health.trend}
          </p>
          <p className="text-xs text-foreground/60">
            {health.basins} basins · λ {health.lambda.toFixed(2)} · pinned{" "}
            {health.pinCount}
          </p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-foreground/60 mb-1">
            Hotspots
          </p>
          {health.hotspots.length === 0 ? (
            <p className="text-xs text-foreground/50">No active stress.</p>
          ) : (
            <ul className="space-y-1 text-xs font-mono">
              {health.hotspots.map((h) => (
                <li key={h.key} className="flex justify-between gap-2">
                  <span className="truncate text-foreground/80">{h.key}</span>
                  <span className="text-destructive">
                    {h.curvature.toFixed(4)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-foreground/60 mb-1">
            Stable basins
          </p>
          {health.coldspots.length === 0 ? (
            <p className="text-xs text-foreground/50">
              No basin-resident keys yet.
            </p>
          ) : (
            <ul className="space-y-1 text-xs font-mono">
              {health.coldspots.map((c) => (
                <li key={c.key} className="truncate text-emerald-400">
                  {c.key}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-foreground/60 mb-1">
            Chain · reward axis
          </p>
          <p className="font-mono text-xs text-foreground/80">
            tip {tipShort} · age {tipAgeLabel} · site{" "}
            {chain.smoothedTipSite ?? "—"}
          </p>
          <p className="font-mono text-xs text-foreground/60">
            blocks {chain.acceptedBlocks} · forks +{chain.acceptedForks} / −
            {chain.rejectedForks}
          </p>
          {chain.lastReorg && (
            <p className="font-mono text-xs text-amber-400">
              reorg depth {chain.lastReorg.depth} · ΔQ{" "}
              {chain.lastReorg.deltaQ.toFixed(4)}
            </p>
          )}
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-foreground/60 mb-1">
            ℓ_min closure
          </p>
          {closure ? (
            <>
              <p
                className={cn(
                  "font-mono text-xs",
                  closure.ok ? "text-emerald-400" : "text-destructive",
                )}
              >
                {closure.ok ? "✓ invariant" : "✗ violated"} · ℓ_min ={" "}
                {closure.ellMin} · residual {closure.maxResidual.toExponential(1)}
              </p>
              <p className="font-mono text-xs text-foreground/60">
                W-bound ratio {closure.composition.growthRatio.toExponential(1)}{" "}
                · antisym {closure.antisymmetry.residual.toExponential(1)}
              </p>
            </>
          ) : (
            <p className="font-mono text-xs text-foreground/50">measuring…</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}