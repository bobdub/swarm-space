/**
 * Synapse map — read-only health of the Gun synaptic map
 * (`src/lib/p2p/synapseExchanger.ts`). Reads local counters only: opening
 * it sends nothing and shows no peer ids, so no one's links are exposed.
 */
import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Network } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getSynapseMapStats, type SynapseMapStats } from '@/lib/p2p/synapseExchanger';

const REFRESH_MS = 5_000;

const ago = (at: number | null): string =>
  at === null ? 'never' : formatDistanceToNow(new Date(at), { addSuffix: true });

export function SynapseMapPanel() {
  const [stats, setStats] = useState<SynapseMapStats>(() => getSynapseMapStats());
  useEffect(() => {
    const id = setInterval(() => setStats(getSynapseMapStats()), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const status = !stats.running ? 'Off' : stats.shy ? 'Listening (shy)' : 'Sharing';
  const rows: Array<[string, string]> = [
    ['Nodes heard from', String(stats.nodes)],
    ['Links they report', String(stats.edges)],
    ['Records received', `${stats.received} · last ${ago(stats.lastReceivedAt)}`],
    ['Records refused', String(stats.refused)],
    [
      'Our record',
      stats.shy
        ? 'Not shared while shy'
        : `${stats.published} sent · last ${ago(stats.lastPublishedAt)}` +
          (stats.lastPublishedChars !== null ? ` · ${stats.lastPublishedChars} chars` : ''),
    ],
    ['Bus Cycle assists', String(stats.assists)],
  ];

  return (
    <Card id="synapse-map" className="scroll-mt-24 border-foreground/10" data-testid="synapse-map-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-4 w-4 text-primary" />
          Synapse Map
          <Badge variant="outline" className="ml-auto text-xs">{status}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Link quality nodes share over Gun, as small numbers only. It helps this node pick smoother peers it has never met; what it sees first-hand always wins.
        </p>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
