import { useEffect, useState } from 'react';
import { HardDrive, Users, ArrowDownToLine, ArrowUpFromLine, Package, RefreshCw, Database } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { TorrentProgress } from '@/lib/p2p/torrentSwarm.standalone';
import { getSwarmMeshStandalone, type AssetSyncStats } from '@/lib/p2p/swarmMesh.standalone';
import { getStandaloneBuilderMode } from '@/lib/p2p/builderMode.standalone';
import { openDB } from '@/lib/store';

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

const emptyAssetSync: AssetSyncStats = {
  manifestsPulled: 0,
  chunksPulled: 0,
  chunksServed: 0,
  pendingManifests: 0,
  activeRetries: 0,
};

async function countStore(storeName: string): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

export function TorrentSwarmPanel() {
  const [torrents, setTorrents] = useState<TorrentProgress[]>([]);
  const [assetSync, setAssetSync] = useState<AssetSyncStats>(emptyAssetSync);
  const [peerCount, setPeerCount] = useState(0);
  const [dbCounts, setDbCounts] = useState({ manifests: 0, chunks: 0 });

  useEffect(() => {
    // Initial IndexedDB count
    const loadCounts = async () => {
      const [manifests, chunks] = await Promise.all([
        countStore('manifests'),
        countStore('chunks'),
      ]);
      setDbCounts({ manifests, chunks });
    };
    void loadCounts();

    const poll = setInterval(() => {
      const sm = getSwarmMeshStandalone();
      const bm = getStandaloneBuilderMode();

      // Asset sync stats from mesh
      const stats = sm.getStats?.();
      if (stats?.assetSync) {
        setAssetSync(stats.assetSync);
      }

      // Peer count — use connections.size from whichever mode is active
      const smPeers = sm.getConnectedPeerIds?.()?.length ?? 0;
      const bmPeers = bm.getConnectedPeerIds?.()?.length ?? 0;
      setPeerCount(Math.max(smPeers, bmPeers));

      // TorrentSwarm overlay stats
      const swarm = sm.getTorrentSwarm?.() ?? bm.getTorrentSwarm?.();
      if (swarm) {
        setTorrents(swarm.getAllProgress());
      } else {
        setTorrents([]);
      }
    }, 2000);

    // Refresh DB counts every 10s
    const dbPoll = setInterval(() => { void loadCounts(); }, 10_000);

    return () => { clearInterval(poll); clearInterval(dbPoll); };
  }, []);

  const totalActivity = assetSync.manifestsPulled + assetSync.chunksPulled + assetSync.chunksServed;
  const hasTorrents = torrents.length > 0;

  return (
    <Card className="p-4 space-y-4 bg-[hsla(245,70%,8%,0.5)] border-foreground/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-wide uppercase">Content Distribution</h3>
        </div>
        {totalActivity > 0 && (
          <Badge variant="outline" className="text-[0.6rem] uppercase tracking-widest border-emerald-500/40 text-emerald-400">
            active
          </Badge>
        )}
      </div>

      {/* Cached content totals from IndexedDB */}
      <div className="rounded-md border border-foreground/10 p-3 space-y-1">
        <div className="flex items-center gap-2 text-[0.6rem] uppercase tracking-wider text-foreground/40">
          <Database className="h-3 w-3" />
          <span>Local Cache</span>
        </div>
        <div className="flex gap-6 text-sm">
          <div>
            <span className="font-bold">{dbCounts.manifests}</span>
            <span className="text-foreground/40 ml-1.5 text-xs">manifests</span>
          </div>
          <div>
            <span className="font-bold">{dbCounts.chunks}</span>
            <span className="text-foreground/40 ml-1.5 text-xs">chunks</span>
          </div>
          <div>
            <span className="font-bold">{peerCount}</span>
            <span className="text-foreground/40 ml-1.5 text-xs">peers</span>
          </div>
        </div>
      </div>

      {/* Session transfer stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatBox
          icon={<ArrowDownToLine className="h-3.5 w-3.5 text-[hsl(174,59%,56%)]" />}
          value={assetSync.manifestsPulled}
          label="Pulled"
        />
        <StatBox
          icon={<Package className="h-3.5 w-3.5 text-[hsl(326,71%,62%)]" />}
          value={assetSync.chunksPulled}
          label="Chunks In"
        />
        <StatBox
          icon={<ArrowUpFromLine className="h-3.5 w-3.5 text-emerald-400" />}
          value={assetSync.chunksServed}
          label="Chunks Out"
        />
        <StatBox
          icon={<Users className="h-3.5 w-3.5 text-primary" />}
          value={peerCount}
          label="Peers"
        />
      </div>

      {/* Pending retries */}
      {assetSync.activeRetries > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-400/80">
          <RefreshCw className="h-3 w-3 animate-spin" />
          <span>{assetSync.activeRetries} asset{assetSync.activeRetries !== 1 ? 's' : ''} retrying ({assetSync.pendingManifests} pending)</span>
        </div>
      )}

      {/* TorrentSwarm overlay torrents (if any) */}
      {hasTorrents && (
        <div className="space-y-2 border-t border-foreground/10 pt-3">
          <div className="text-[0.6rem] uppercase tracking-wider text-foreground/40">
            Torrent Swarm Overlay
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {torrents.map((t) => (
              <TorrentRow key={t.manifestId} progress={t} />
            ))}
          </div>
        </div>
      )}

      {dbCounts.manifests === 0 && dbCounts.chunks === 0 && totalActivity === 0 && !hasTorrents && (
        <p className="text-xs text-foreground/30 text-center py-2">
          No content distribution activity yet — upload media to start sharing
        </p>
      )}
    </Card>
  );
}

function StatBox({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-foreground/10 p-2">
      {icon}
      <div>
        <div className="text-sm font-bold leading-none">{value}</div>
        <div className="text-[0.55rem] uppercase tracking-wider text-foreground/40 mt-0.5">{label}</div>
      </div>
    </div>
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
