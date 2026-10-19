import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QCMChart } from "@/components/QCMChart";
import { Activity } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import { getQcmSeriesForUser } from "@/lib/achievementsStore";
import { getAll } from "@/lib/store";
import type { Post, QcmSeriesPoint } from "@/types";
import {
  ACTIVITY_SERIES_KEYS,
  ACTIVITY_WEIGHTS,
  aggregateDaily,
  countBySeries,
  dayKey,
  nextTier,
  subscribeLiveActivity,
} from "@/lib/activityMetrics";

const SERIES_META: Record<string, { label: string; symbol: string; weightLabel: string }> = {
  posts: { label: "Posting", symbol: "P", weightLabel: `+${ACTIVITY_WEIGHTS.post_text} text / +${ACTIVITY_WEIGHTS.post_media} media` },
  comments: { label: "Comments", symbol: "C", weightLabel: `+${ACTIVITY_WEIGHTS.comment} each` },
  mining: { label: "Axe", symbol: "A", weightLabel: `+${ACTIVITY_WEIGHTS.block_mined} per block` },
  brain: { label: "Brain", symbol: "B", weightLabel: `+${ACTIVITY_WEIGHTS.brain_peer} per session` },
};

/** Number that smoothly counts toward its target and pulses when it changes. */
function LiveNumber({ value, decimals = 0, className = "" }: { value: number; decimals?: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [pulse, setPulse] = useState(false);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    setPulse(true);
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      setShown(from + (value - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(step);
    const timer = setTimeout(() => setPulse(false), 700);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      fromRef.current = value;
    };
  }, [value]);

  return (
    <span
      className={`inline-block tabular-nums transition-all duration-300 ${pulse ? "scale-125 text-primary" : ""} ${className}`}
    >
      {shown.toFixed(decimals)}
    </span>
  );
}

export function QuantumMetricsPanel() {
  const { user } = useAuth();
  const { stats, getActivePeerConnections } = useP2PContext();
  const meshPeers = Math.max(stats.connectedPeers, getActivePeerConnections().length);
  const meshOnline = meshPeers > 0;
  const [points, setPoints] = useState<QcmSeriesPoint[]>([]);
  const [seedPostCount, setSeedPostCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const loadMetrics = useCallback(async () => {
    if (!user) return;
    try {
      const grouped = await getQcmSeriesForUser(user.id);
      const activityPoints = ACTIVITY_SERIES_KEYS.flatMap((key) =>
        (grouped[key] ?? []).filter((p) => p.source === "activity")
      );
      setPoints(activityPoints);
      if (activityPoints.length === 0) {
        const allPosts = await getAll<Post>("posts");
        setSeedPostCount(allPosts.filter((p) => p.author === user.id).length);
      }
    } catch (error) {
      console.error("[QuantumMetrics] Failed to load metrics:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Disk is only the history archive; live bus points append instantly.
  useEffect(() => {
    void loadMetrics();
    if (!user) return;
    const unsubscribe = subscribeLiveActivity((point) => {
      if (point.userId !== user.id) return;
      setPoints((prev) => (prev.some((p) => p.id === point.id) ? prev : [...prev, point]));
    });
    // Roll the day over live, and re-sync with the archive when the tab returns.
    const onVisible = () => { if (document.visibilityState === "visible") void loadMetrics(); };
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(tick);
    };
  }, [loadMetrics, user]);

  const daily = useMemo(() => aggregateDaily(points), [points]);
  const counts = useMemo(() => countBySeries(points), [points]);
  const todayKey = dayKey(new Date(now).toISOString());

  const chartSeries = useMemo(() => {
    const series: Record<string, QcmSeriesPoint[]> = {};
    for (const key of ACTIVITY_SERIES_KEYS) {
      series[key] = daily
        .filter((d) => (d.series[key] ?? 0) > 0)
        .map((d) => ({
          id: `${key}-${d.day}`,
          userId: user?.id ?? "",
          series: key,
          value: Number((d.series[key] ?? 0).toFixed(4)),
          recordedAt: d.day,
        }));
    }
    if (points.length === 0 && meshOnline && seedPostCount > 0) {
      series.posts = [
        {
          id: `posts-seed-${todayKey}`,
          userId: user?.id ?? "",
          series: "posts",
          value: seedPostCount * ACTIVITY_WEIGHTS.post_text,
          recordedAt: todayKey,
        },
      ];
    }
    return series;
  }, [daily, user?.id, points.length, meshOnline, seedPostCount, todayKey]);

  const hasChart = useMemo(() => Object.values(chartSeries).some((s) => s.length > 0), [chartSeries]);

  const today = daily.find((d) => d.day === todayKey);
  const tP = today?.series.posts ?? 0;
  const tC = today?.series.comments ?? 0;
  const tA = today?.series.mining ?? 0;
  const tB = today?.series.brain ?? 0;
  const todayTotal = tP + tC + tA + tB;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Network Activity
        </CardTitle>
        <CardDescription>Your daily activity score, built from real actions on the swarm</CardDescription>
      </CardHeader>
      <CardContent>
        <QCMChart
          series={chartSeries}
          isLoading={loading}
          emptyMessage="Post, comment, mine, or join the Brain to start your activity chart"
        />

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACTIVITY_SERIES_KEYS.map((key) => {
            const meta = SERIES_META[key];
            const count = counts[key] ?? 0;
            const tier = nextTier(count);
            return (
              <div key={key} className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
                <p className="text-xs font-semibold text-foreground">
                  <span className="text-primary">{meta.symbol}</span> · {meta.label}
                </p>
                <p className="mt-0.5 text-lg font-bold text-foreground">
                  <LiveNumber value={count} />
                </p>
                <p className="text-[10px] text-muted-foreground">{meta.weightLabel}</p>
                {tier !== null && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Next badge at {tier} ({Math.max(0, tier - count)} to go)
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {hasChart && !meshOnline && (
          <p className="mt-4 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent-foreground">
            Not connected to the network — your chart is saved locally and will sync once a peer is online.
          </p>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Today's activity score (D):{" "}
          <span className="font-semibold text-foreground">{todayTotal.toFixed(2)}</span> — the weighted sum of
          everything you did today. Badges unlock automatically at 25, 50, 100, 250, 500, and 1000 actions in each
          category.
        </p>

        <div className="mt-4 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background/40 to-accent/10 px-4 py-3">
          <p className="flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${meshOnline ? "animate-pulse bg-primary" : "bg-muted-foreground"}`} />
            Resonance of the Swarm · live
          </p>
          <p className="mt-1 text-center font-serif text-lg italic text-foreground/90">
            Ĥ<sub className="text-xs">swarm</sub> = ∮ (P + C + A + B) dτ
          </p>
          <p className="text-center font-mono text-[10px] text-muted-foreground">
            P = T + 2M · C = c/20 · A = a/100 · B = b/50
          </p>
          <p className="mt-2 flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-1 font-mono text-base">
            <span className="font-bold text-primary">D</span>
            <span className="text-muted-foreground">=</span>
            <LiveNumber value={tP} decimals={2} />
            <span className="text-muted-foreground">+</span>
            <LiveNumber value={tC} decimals={2} />
            <span className="text-muted-foreground">+</span>
            <LiveNumber value={tA} decimals={2} />
            <span className="text-muted-foreground">+</span>
            <LiveNumber value={tB} decimals={2} />
            <span className="text-muted-foreground">=</span>
            <LiveNumber value={todayTotal} decimals={2} className="text-lg font-bold text-primary" />
          </p>
          <p className="mt-1 text-center text-[10px] text-muted-foreground">
            P · C · A · B today {meshOnline ? `· live on the mesh (${meshPeers} peer${meshPeers === 1 ? "" : "s"})` : "· waiting for peers"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
