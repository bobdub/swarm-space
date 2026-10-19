import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QCMChart } from "@/components/QCMChart";
import { Activity, Flame } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import { getQcmSeriesForUser } from "@/lib/achievementsStore";
import { getAll } from "@/lib/store";
import type { Post, QcmSeriesPoint } from "@/types";
import { CREDIT_REWARDS } from "@/lib/credits";
import {
  ACTIVITY_SERIES_KEYS,
  ACTIVITY_WEIGHTS,
  aggregateDaily,
  countBySeries,
  dayKey,
  nextTier,
} from "@/lib/activityMetrics";

const SERIES_META: Record<string, { label: string; symbol: string; weightLabel: string }> = {
  posts: { label: "Posting", symbol: "P", weightLabel: `+${ACTIVITY_WEIGHTS.post_text} text / +${ACTIVITY_WEIGHTS.post_media} media` },
  comments: { label: "Comments", symbol: "C", weightLabel: `+${ACTIVITY_WEIGHTS.comment} each` },
  mining: { label: "Axe", symbol: "A", weightLabel: `+${ACTIVITY_WEIGHTS.block_mined} per block` },
  brain: { label: "Brain", symbol: "B", weightLabel: `+${ACTIVITY_WEIGHTS.brain_peer} per session` },
};

export function QuantumMetricsPanel() {
  const { user } = useAuth();
  const [points, setPoints] = useState<QcmSeriesPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const loadMetrics = async () => {
      try {
        const grouped = await getQcmSeriesForUser(user.id);
        const activityPoints = ACTIVITY_SERIES_KEYS.flatMap((key) =>
          (grouped[key] ?? []).filter((p) => p.source === "activity")
        );
        setPoints(activityPoints);
      } catch (error) {
        console.error("[QuantumMetrics] Failed to load metrics:", error);
      } finally {
        setLoading(false);
      }
    };

    void loadMetrics();
  }, [user]);

  const daily = useMemo(() => aggregateDaily(points), [points]);
  const counts = useMemo(() => countBySeries(points), [points]);

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
    return series;
  }, [daily, user?.id]);

  const todayKey = dayKey(new Date().toISOString());
  const today = daily.find((d) => d.day === todayKey);
  const todayTotal = today?.total ?? 0;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Network Activity
            </CardTitle>
            <CardDescription>
              Your daily activity score, built from real actions on the swarm
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-1.5">
            <Flame className="h-4 w-4 text-destructive" />
            <span className="text-sm font-medium text-destructive">
              -{CREDIT_REWARDS.DAILY_BURN} SWARM/day
            </span>
          </div>
        </div>
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
              <div
                key={key}
                className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2"
              >
                <p className="text-xs font-semibold text-foreground">
                  <span className="text-primary">{meta.symbol}</span> · {meta.label}
                </p>
                <p className="mt-0.5 text-lg font-bold text-foreground">{count}</p>
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

        <p className="mt-4 text-xs text-muted-foreground">
          Today's activity score (D):{" "}
          <span className="font-semibold text-foreground">{todayTotal.toFixed(2)}</span>
          {" "}— the weighted sum of everything you did today. Badges unlock automatically at
          25, 50, 100, 250, 500, and 1000 actions in each category.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Daily network maintenance costs {CREDIT_REWARDS.DAILY_BURN} SWARM tokens.
        </p>
      </CardContent>
    </Card>
  );
}
