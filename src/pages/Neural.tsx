/**
 * /neural — live health of the synaptic map (Gun Synapse Exchanger,
 * self-tuning dispatch weights). Reads this tab's local counters only:
 * opening it sends nothing and shows no peer ids, so no one's links are
 * exposed. Lets anyone check Phases 1–3 on a real device without dev tools.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronLeft, CircleDashed, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSynapseMapStats, type SynapseMapStats } from "@/lib/p2p/synapseExchanger";
import { DEFAULT_RESISTANCE_WEIGHTS, getResistanceWeights, weightQScore } from "@/lib/p2p/synapticDispatch";
import { ago, neuralChecks, type CheckState, type NeuralWeights } from "@/lib/p2p/neuralChecks";

const REFRESH_MS = 5_000;

type Weights = NeuralWeights;

const ICONS: Record<CheckState, JSX.Element> = {
  pass: <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-label="ok" />,
  wait: <CircleDashed className="h-5 w-5 shrink-0 text-amber-500" aria-label="waiting" />,
  fail: <XCircle className="h-5 w-5 shrink-0 text-destructive" aria-label="problem" />,
};

function Rows({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <dl className="space-y-3">
      {rows.map(([label, value, hint]) => (
        <div key={label}>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-right text-sm font-medium tabular-nums">{value}</dd>
          </div>
          <p className="text-xs text-foreground/50">{hint}</p>
        </div>
      ))}
    </dl>
  );
}

const groundQ = weightQScore(DEFAULT_RESISTANCE_WEIGHTS);

export default function Neural() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<SynapseMapStats>(() => getSynapseMapStats());
  const [weights, setWeights] = useState<Weights>(() => getResistanceWeights());
  const [checkedAt, setCheckedAt] = useState(() => Date.now());

  const refresh = useCallback(() => {
    setStats(getSynapseMapStats());
    setWeights(getResistanceWeights());
    setCheckedAt(Date.now());
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const checks = neuralChecks(stats, weights);
  const status = !stats.running ? "Off" : stats.shy ? "Listening (shy)" : "Sharing";

  const mapRows: Array<[string, string, string]> = [
    ["Nodes heard from", String(stats.nodes), "Nodes whose fresh, signed record this tab holds."],
    ["Vouched", `${stats.vouched} of ${stats.nodes}`, "Signed with the identity your Connection Library knows them by. These count fully; the rest count half."],
    ["Links they report", String(stats.edges), "Each is a peer key, smoothness, latency and weight. Never content."],
    ["Records received", `${stats.received} · last ${ago(stats.lastReceivedAt)}`, "Accepted after the signature checked out."],
    ["Records refused", String(stats.refused), "Bad signature, a different key than the first one seen, malformed, or too old."],
    [
      "Our record",
      stats.shy
        ? "Not shared while shy"
        : stats.unsigned
          ? "Waiting for a signing key"
          : `${stats.published} sent · last ${ago(stats.lastPublishedAt)}`,
      stats.lastPublishedChars !== null
        ? `Last record was ${stats.lastPublishedChars} characters of packed binary.`
        : "Packed binary, about 540 characters at most.",
    ],
    ["Bus Cycle assists", String(stats.assists), "Times the map broke a tie for a peer we had no memory of. First-hand always wins."],
  ];

  const weightBars: Array<[string, number, number]> = [
    ["Latency", weights.latency, DEFAULT_RESISTANCE_WEIGHTS.latency],
    ["Failures", weights.failure, DEFAULT_RESISTANCE_WEIGHTS.failure],
    ["Load", weights.load, DEFAULT_RESISTANCE_WEIGHTS.load],
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/40 bg-background/80 p-3 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">Neural Map</h1>
        <Badge variant="outline" className="ml-2 text-xs" data-testid="neural-status">{status}</Badge>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={refresh} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 p-4" data-testid="neural-page">
        <p className="text-sm text-foreground/60">
          How this device shares link quality over Gun and uses it to pick peers. Everything here is read from this tab;
          opening the page sends nothing. Updates every 5 seconds, last checked {ago(checkedAt)}.
        </p>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-primary">Checks</h2>
          <ul className="space-y-3">
            {checks.map((c) => (
              <li key={c.label} className="flex gap-3" data-testid={`neural-check-${c.state}`}>
                {ICONS[c.state]}
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-foreground/50">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-primary">Synapse map</h2>
          <Rows rows={mapRows} />
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold text-primary">Source weights</h2>
          <p className="mb-3 text-xs text-foreground/50">
            When a file can come from several peers, the one with the lowest resistance is asked first. These weights
            tune themselves with the UQRC step from how each ask went. The marker shows where they started.
          </p>
          <div className="space-y-3">
            {weightBars.map(([label, value, start]) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums">{value.toFixed(3)}</span>
                </div>
                <div className="relative h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, value * 100)}%` }} />
                  <div className="absolute -top-1 h-4 w-0.5 bg-foreground/60" style={{ left: `${start * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Rows
              rows={[
                ["Learned from", `${weights.samples} asks`, "Saved on this device only, never published."],
                [
                  "Q-score",
                  weights.qScore.toFixed(3),
                  `Curvature of the weights. Lower is calmer; the starting weights read ${groundQ.toFixed(3)}.`,
                ],
              ]}
            />
          </div>
        </Card>
      </main>
    </div>
  );
}
