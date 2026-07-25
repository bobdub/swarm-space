import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { listLoadingPoints, registerDefaultPoints } from '@/lib/guardrails/loadingChain';
import {
  getLoadingChainConfig,
  setLoadingChainConfig,
  defaultChainFor,
  type LoadingChainConfig,
} from '@/lib/guardrails/config';

// Ensure defaults are known even if the runner hasn't started yet
// (Settings can open before boot finishes).
registerDefaultPoints();

export function LoadingChainEditor() {
  const [cfg, setCfg] = useState<LoadingChainConfig>(() => getLoadingChainConfig());
  const points = useMemo(() => {
    const map = new Map(listLoadingPoints().map((p) => [p.id, p]));
    return cfg.order.map((id) => map.get(id)).filter(Boolean) as ReturnType<typeof listLoadingPoints>;
  }, [cfg]);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...cfg.order];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    // 'local' stays first — it is essential.
    if (next[idx] === 'local' || next[target] === 'local') return;
    [next[idx], next[target]] = [next[target], next[idx]];
    const updated = { ...cfg, order: next };
    setCfg(updated);
    setLoadingChainConfig(updated);
  };

  const toggleAdaptive = (v: boolean) => {
    const updated = { ...cfg, adaptive: v };
    setCfg(updated);
    setLoadingChainConfig(updated);
  };

  const resetToPreset = () => {
    const updated: LoadingChainConfig = { order: defaultChainFor(), adaptive: true };
    setCfg(updated);
    setLoadingChainConfig(updated);
    toast.success('Loading chain reset to preset defaults');
  };

  return (
    <Card className="space-y-4 rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
      <div className="flex items-start gap-3">
        <Sparkles className="h-5 w-5 text-accent shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h2 className="text-xl font-bold">Browser Guardrails</h2>
          <p className="text-sm text-foreground/60">
            Reorder subsystems and let the app pause background loading when
            your browser is stressed. Local first is pinned — everything else
            you can rearrange.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.35)] px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Adaptive pausing</p>
          <p className="text-xs text-foreground/60">
            Delay non-critical subsystems if the browser gets close to a stall.
          </p>
        </div>
        <Switch checked={cfg.adaptive} onCheckedChange={toggleAdaptive} />
      </div>

      <ol className="space-y-2">
        {points.map((p, idx) => {
          const pinned = p.id === 'local';
          return (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.35)] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {idx + 1}. {p.label}
                  {pinned && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-accent">
                      pinned
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-foreground/50">
                  min Q {p.minQScore.toFixed(2)} · pause &lt; {p.pauseBelowQScore.toFixed(2)}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={pinned || idx <= 1}
                  onClick={() => move(idx, -1)}
                  aria-label={`Move ${p.label} up`}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={pinned || idx >= points.length - 1}
                  onClick={() => move(idx, 1)}
                  aria-label={`Move ${p.label} down`}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-foreground/50">
          Changes take effect on next reload.
        </p>
        <Button type="button" variant="outline" onClick={resetToPreset} className="gap-2">
          <RotateCcw className="h-4 w-4" />
          Reset to preset
        </Button>
      </div>
    </Card>
  );
}

export default LoadingChainEditor;