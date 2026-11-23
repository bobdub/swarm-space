import { useEffect, useState, useSyncExternalStore } from 'react';
import { AGENT_TIERS, TIER_LABELS, TIER_START_MS, msToNextTier } from '@/lib/brain/agent/connectionClock';
import { getAgentStatus, subscribeAgent } from '@/lib/brain/agent/infinityAgent';
import { getSynapseGraph, nodeKey, nodeKind, type SynapseLink } from '@/lib/brain/agent/synapseGraph';

const minutes = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const label = (id: string) => {
  const kind = nodeKind(id);
  const key = nodeKey(id);
  if (kind === 'coin') return `memory coin ${key.slice(0, 6)}`;
  if (kind === 'peer') return `a peer's basin`;
  return key;
};

/** Show which way a path mostly runs once one direction clearly leads. */
const arrow = (l: SynapseLink) => {
  const ab = l.ab ?? 0;
  const ba = l.ba ?? 0;
  if (ab > 2 * ba && ab > 0) return '→';
  if (ba > 2 * ab && ba > 0) return '←';
  return '↔';
};

/** Infinity's agent status and the strongest paths in its synapse graph. */
export function InfinityAgentPanel(): JSX.Element {
  const status = useSyncExternalStore(subscribeAgent, getAgentStatus, getAgentStatus);
  const [links, setLinks] = useState<SynapseLink[]>([]);
  useEffect(() => {
    const read = () => setLinks(getSynapseGraph().strongest(12));
    read();
    const id = setInterval(read, 30_000);
    return () => clearInterval(id);
  }, [status.graph.links]);
  const next = msToNextTier(status.connectedMs);
  const current = AGENT_TIERS.indexOf(status.tier);

  return <section aria-label="Infinity brain map" className="space-y-6 py-6 text-sm">
    <div>
      <h2 className="font-semibold text-foreground">{TIER_LABELS[status.tier]}</h2>
      <p className="mt-1 text-muted-foreground">
        {status.connectedMs > 0 ? `Connected for ${minutes(status.connectedMs)}` : 'Not connected to peers yet'}
        {next ? ` · ${TIER_LABELS[next.tier].toLowerCase()} in ${minutes(next.ms)}` : ''}
      </p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-5" aria-label="Connection tiers">
        {AGENT_TIERS.map((t, i) => <li key={t} className={`rounded-md border px-3 py-2 ${i <= current ? 'border-primary/60 text-foreground' : 'border-border text-muted-foreground'}`}>
          <div className="text-xs">{TIER_START_MS[t] === 0 ? 'Always' : `${minutes(TIER_START_MS[t])}+`}</div>
          <div>{TIER_LABELS[t]}</div>
        </li>)}
      </ol>
    </div>
    <div>
      <h2 className="font-semibold text-foreground">Strongest paths</h2>
      <p className="mt-1 text-muted-foreground">{status.graph.nodes} nodes · {status.graph.links} links, kept on this device only.</p>
      {links.length ? <ul className="mt-3 space-y-1">
        {links.map((l) => <li key={`${l.a}|${l.b}`} className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
          <span className="min-w-0 truncate">{label(l.a)} {arrow(l)} {label(l.b)}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{l.w.toFixed(2)}</span>
        </li>)}
      </ul> : <p className="mt-3 text-muted-foreground">No paths yet. They grow as Infinity learns from people who are not shy.</p>}
    </div>
  </section>;
}

export default InfinityAgentPanel;
