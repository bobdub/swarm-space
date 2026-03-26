import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QCMChart } from "@/components/QCMChart";
import { Activity, Flame } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getQcmSeriesForUser } from "@/lib/achievementsStore";
import type { QcmSeriesPoint } from "@/types";
import { CREDIT_REWARDS } from "@/lib/credits";
import { getOptimizedMiningEngine } from "@/lib/blockchain/miningOptimizations";
import { buildUqrcStateSnapshot } from "@/lib/uqrc/state";
import { deriveUqrcConsciousState, type UqrcConsciousState } from "@/lib/uqrc/conscious";
import { deriveUqrcPersonalityState, type UqrcPersonalityState } from "@/lib/uqrc/personality";

export function QuantumMetricsPanel() {
  const { user } = useAuth();
  const [series, setSeries] = useState<Record<string, QcmSeriesPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [uqrcHealth, setUqrcHealth] = useState<number | null>(null);
  const [personality, setPersonality] = useState<UqrcPersonalityState | null>(null);
  const [conscious, setConscious] = useState<UqrcConsciousState | null>(null);

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

  useEffect(() => {
    const engine = getOptimizedMiningEngine();
    const curvature = engine.getCurvatureMetrics();
    const totalPoints = Object.values(series).reduce((sum, values) => sum + values.length, 0);

    const personalityState = deriveUqrcPersonalityState({
      sessionActive: true,
      uptimeMs: totalPoints * 1_000,
      connectionAttempts: totalPoints,
      successfulConnections: Math.round(totalPoints * Math.max(0.5, 1 - curvature.totalQScore)),
      failedConnectionAttempts: Math.max(0, Math.round(totalPoints * curvature.totalQScore * 0.2)),
      rendezvousAttempts: Math.max(1, Math.round(totalPoints / 2)),
      rendezvousSuccesses: Math.max(1, Math.round((totalPoints / 2) * Math.max(0.55, 1 - curvature.propagationCurvature))),
      relayCount: totalPoints,
      pingCount: totalPoints,
      accountId: user?.id,
    });


    const consciousState = deriveUqrcConsciousState({
      sessionActive: true,
      uptimeMs: totalPoints * 1_000,
      connectionAttempts: totalPoints,
      successfulConnections: Math.round(totalPoints * Math.max(0.5, 1 - curvature.totalQScore)),
      failedConnectionAttempts: Math.max(0, Math.round(totalPoints * curvature.totalQScore * 0.2)),
      rendezvousAttempts: Math.max(1, Math.round(totalPoints / 2)),
      rendezvousSuccesses: Math.max(1, Math.round((totalPoints / 2) * Math.max(0.55, 1 - curvature.propagationCurvature))),
      relayCount: totalPoints,
      pingCount: totalPoints,
      bytesUploaded: totalPoints * 120,
      bytesDownloaded: totalPoints * 95,
      accountId: user?.id,
    });

    const snapshot = buildUqrcStateSnapshot({
      timestamp: Date.now(),
      trace: 'quantum-metrics-panel',
      cortex: {
        noveltyScore: Math.min(1, totalPoints / 300),
        semanticDensity: Math.min(1, Object.keys(series).length / 8),
        interactionVelocity: Math.min(1, totalPoints / 500),
        reflectionDepth: Math.min(1, totalPoints / 1000),
        rollingEntropy: Math.min(1, curvature.totalQScore),
      },
      limbic: { rewardFlux: 0.7, influenceWeight: 0.6, energyBudget: 0.8, burnPressure: 0.2 },
      brainstem: { peerLiveness: 0.75, heartbeatIntervalMs: 0.3, messageRedundancy: 0.7, survivalConfidence: 0.8 },
      memory: { chunkRedundancy: 0.7, manifestIntegrity: 0.85, recallLatencyMs: 0.25, reconstructionSuccess: 0.8 },
      heartbeat: {
        hashRateEffective: 0.75,
        qScoreTotal: Math.min(1, curvature.totalQScore),
        propagationCurvature: curvature.propagationCurvature,
        timestampCurvature: curvature.timestampCurvature,
      },
      ethics: { harmRisk: 0.1, confidence: 0.9, interventionLevel: 0.2 },
      personality: personalityState,
      conscious: consciousState,
    });

    setUqrcHealth(snapshot.healthScore);
    setPersonality(snapshot.personality);
    setConscious(snapshot.conscious);
  }, [series, user?.id]);

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
        {uqrcHealth !== null && (
          <p className="mt-2 text-xs text-primary/90">
            UQRC health score: <span className="font-semibold">{uqrcHealth}%</span>
          </p>
        )}
        {personality && (
          <p className="mt-1 text-xs text-muted-foreground">
            Intent: <span className="font-semibold text-foreground">{personality.intent}</span>
            {' '}· Mode: <span className="font-semibold text-foreground">{personality.engagementMode}</span>
            {' '}· Bias: <span className="font-semibold text-foreground">{personality.interventionBias}</span>
            {' '}· Coop: <span className="font-semibold text-foreground">{Math.round(personality.cooperationScore * 100)}%</span>
          </p>
        )}
        {conscious && (
          <p className="mt-1 text-xs text-muted-foreground">
            Conscious intent: <span className="font-semibold text-foreground">{conscious.intent}</span>
            {' '}· phase: <span className="font-semibold text-foreground">{conscious.phase}</span>
            {' '}· coherence: <span className="font-semibold text-foreground">{Math.round(conscious.coherenceScore * 100)}%</span>
            {' '}· continuity: <span className="font-semibold text-foreground">{Math.round(conscious.subconscious.sessionContinuity * 100)}%</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
