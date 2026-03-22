import { useEffect, useState } from 'react';
import { HardDrive, Users, ArrowDownToLine, ArrowUpFromLine, Package } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { TorrentProgress } from '@/lib/p2p/torrentSwarm.standalone';
import { getSwarmMeshStandalone } from '@/lib/p2p/swarmMesh.standalone';
import { getStandaloneBuilderMode } from '@/lib/p2p/builderMode.standalone';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const stateColors: Record<string, string> = {
  seeding: 'text-emerald-400 border-emerald-500/40',
  downloading: 'text-amber-400 border-amber-500/40',
  complete: 'text-sky-400 border-sky-500/40',
  error: 'text-destructive border-destructive/40',
  idle: 'text-muted-foreground border-foreground/20',
};

const stateLabels: Record<string, string> = {
  seeding: 'Seeding',
  downloading: 'Downloading',
  complete: 'Complete',
  error: 'Error',
  idle: 'Idle',
};

export function TorrentSwarmPanel() {
  const [torrents, setTorrents] = useState<TorrentProgress[]>([]);
  const [totalStats, setTotalStats] = useState({ activeTorrents: 0, totalSeeders: 0, totalChunks: 0, completedChunks: 0 });

  useEffect(() => {
    const poll = setInterval(() => {
      const swarm = getSwarmMeshStandalone().getTorrentSwarm?.() ?? getStandaloneBuilderMode().getTorrentSwarm?.();
      if (swarm) {
        setTorrents(swarm.getAllProgress());
        setTotalStats(swarm.getTotalStats());
      } else {
        setTorrents([]);
        setTotalStats({ activeTorrents: 0, totalSeeders: 0, totalChunks: 0, completedChunks: 0 });
      }
    }, 2000);
    return () => clearInterval(poll);
  }, []);

  const overallPercent = totalStats.totalChunks > 0
    ? Math.round((totalStats.completedChunks / totalStats.totalChunks) * 100)
    : 0;

  return (
    <Card className="p-4 space-y-4 bg-[hsla(245,70%,8%,0.5)] border-foreground/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-wide uppercase">Torrent Swarm</h3>
        </div>
        <Badge variant="outline" className="text-[0.6rem] uppercase tracking-widest border-foreground/20 text-foreground/50">
          {totalStats.activeTorrents} active
        </Badge>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex items-center gap-2 rounded-md border border-foreground/10 p-2">
          <Package className="h-3.5 w-3.5 text-[hsl(174,59%,56%)]" />
          <div>
            <div className="text-sm font-bold leading-none">{totalStats.activeTorrents}</div>
            <div className="text-[0.55rem] uppercase tracking-wider text-foreground/40 mt-0.5">Torrents</div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-foreground/10 p-2">
          <Users className="h-3.5 w-3.5 text-[hsl(326,71%,62%)]" />
          <div>
            <div className="text-sm font-bold leading-none">{totalStats.totalSeeders}</div>
            <div className="text-[0.55rem] uppercase tracking-wider text-foreground/40 mt-0.5">Seeders</div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-foreground/10 p-2">
          <ArrowDownToLine className="h-3.5 w-3.5 text-emerald-400" />
          <div>
            <div className="text-sm font-bold leading-none">{overallPercent}%</div>
            <div className="text-[0.55rem] uppercase tracking-wider text-foreground/40 mt-0.5">Chunks</div>
          </div>
        </div>
      </div>

      {/* Overall progress */}
      {totalStats.activeTorrents > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-[0.6rem] text-foreground/40 uppercase tracking-wider">
            <span>Overall distribution</span>
            <span>{totalStats.completedChunks} / {totalStats.totalChunks} chunks</span>
          </div>
          <Progress value={overallPercent} className="h-2" />
        </div>
      )}

      {/* Individual torrents */}
      {torrents.length === 0 ? (
        <p className="text-xs text-foreground/30 text-center py-3">
          No active torrents — share a file to start swarming
        </p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {torrents.map((t) => (
            <TorrentRow key={t.manifestId} progress={t} />
          ))}
        </div>
      )}
    </Card>
  );
}

function TorrentRow({ progress }: { progress: TorrentProgress }) {
  const colors = stateColors[progress.state] ?? stateColors.idle;

  return (
    <div className="rounded-md border border-foreground/10 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {progress.state === 'seeding' ? (
            <ArrowUpFromLine className="h-3 w-3 shrink-0 text-emerald-400" />
          ) : (
            <ArrowDownToLine className="h-3 w-3 shrink-0 text-amber-400" />
          )}
          <span className="text-xs font-mono truncate text-foreground/70">
            {progress.manifestId.slice(0, 16)}…
          </span>
        </div>
        <Badge variant="outline" className={cn('text-[0.55rem] uppercase tracking-widest', colors)}>
          {stateLabels[progress.state] ?? progress.state}
        </Badge>
      </div>

      <Progress value={progress.percent} className="h-1.5" />

      <div className="flex justify-between text-[0.55rem] text-foreground/40">
        <span>{progress.receivedChunks}/{progress.totalChunks} chunks • {formatBytes(progress.bytesReceived)}/{formatBytes(progress.bytesTotal)}</span>
        <span>{progress.seeders} seeders • {progress.activePeers} active</span>
      </div>
    </div>
  );
}
