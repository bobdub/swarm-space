import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QCMChart } from "@/components/QCMChart";
import { Activity, Flame } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getQcmSeriesForUser } from "@/lib/achievementsStore";
import type { QcmSeriesPoint } from "@/types";
import { CREDIT_REWARDS } from "@/lib/credits";

export function QuantumMetricsPanel() {
  const { user } = useAuth();
  const [series, setSeries] = useState<Record<string, QcmSeriesPoint[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const loadMetrics = async () => {
      try {
        const data = await getQcmSeriesForUser(user.id);
        setSeries(data);
      } catch (error) {
        console.error("[QuantumMetrics] Failed to load metrics:", error);
      } finally {
        setLoading(false);
      }
    };

    void loadMetrics();
  }, [user]);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Quantum Consciousness Metrics
            </CardTitle>
            <CardDescription>
              Your network activity patterns and consciousness spikes
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
          series={series} 
          isLoading={loading}
          emptyMessage="Complete actions to generate quantum consciousness patterns"
        />
        <p className="mt-4 text-xs text-muted-foreground">
          Quantum metrics compute your network contribution patterns. Daily computation costs {CREDIT_REWARDS.DAILY_BURN} SWARM tokens.
        </p>
      </CardContent>
    </Card>
  );
}
