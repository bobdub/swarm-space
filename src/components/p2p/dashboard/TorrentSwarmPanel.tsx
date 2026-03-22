import { useEffect, useState, useCallback } from 'react';
import {
  HardDrive, Users, ArrowDownToLine, ArrowUpFromLine, Package,
  RefreshCw, Database, Pause, Play, Ban, Star, FileIcon,
  Image, Music, Film, FileText, Trash2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TorrentProgress } from '@/lib/p2p/torrentSwarm.standalone';
import { getSwarmMeshStandalone, type AssetSyncStats } from '@/lib/p2p/swarmMesh.standalone';
import { getStandaloneBuilderMode } from '@/lib/p2p/builderMode.standalone';
import { openDB } from '@/lib/store';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TorrentProgress } from '@/lib/p2p/torrentSwarm.standalone';
import { getSwarmMeshStandalone, type AssetSyncStats } from '@/lib/p2p/swarmMesh.standalone';
import { getStandaloneBuilderMode } from '@/lib/p2p/builderMode.standalone';
import { openDB } from '@/lib/store';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function mimeIcon(mime: string) {
  if (mime.startsWith('image')) return <Image className="h-3.5 w-3.5 text-sky-400" />;
  if (mime.startsWith('audio')) return <Music className="h-3.5 w-3.5 text-purple-400" />;
  if (mime.startsWith('video')) return <Film className="h-3.5 w-3.5 text-rose-400" />;
  if (mime.startsWith('text') || mime.includes('pdf')) return <FileText className="h-3.5 w-3.5 text-amber-400" />;
  return <FileIcon className="h-3.5 w-3.5 text-foreground/40" />;
}

interface FileTransferInfo {
  fileId: string;
  name: string;
  mime: string;
  totalChunks: number;
  receivedChunks: number;
  size: number;
  percent: number;
  retrying: boolean;
  prefs: { paused: boolean; ignored: boolean; hostFirst: boolean };
}

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
  const [files, setFiles] = useState<FileTransferInfo[]>([]);

  const loadFiles = useCallback(async () => {
    const sm = getSwarmMeshStandalone();
    if (sm.getFileTransferList) {
      try {
        const list = await sm.getFileTransferList();
        setFiles(list);
      } catch {
        // fallback: load from IndexedDB directly
        await loadFilesFromDB();
      }
    } else {
      await loadFilesFromDB();
    }
  }, []);

  const loadFilesFromDB = async () => {
    try {
      const db = await openDB();
      if (!db.objectStoreNames.contains('manifests')) return;
      const manifests = await new Promise<Array<Record<string, unknown>>>((resolve) => {
        const tx = db.transaction('manifests', 'readonly');
        const req = tx.objectStore('manifests').getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => resolve([]);
      });

      const chunkKeys = new Set<string>();
      if (db.objectStoreNames.contains('chunks')) {
        await new Promise<void>((resolve) => {
          const tx = db.transaction('chunks', 'readonly');
          const req = tx.objectStore('chunks').getAllKeys();
          req.onsuccess = () => {
            for (const k of (req.result ?? [])) {
              if (typeof k === 'string') chunkKeys.add(k);
            }
            resolve();
          };
          req.onerror = () => resolve();
        });
      }

      const list: FileTransferInfo[] = [];
      for (const m of manifests) {
        const fileId = m.fileId as string ?? '';
        if (!fileId) continue;
        const refs = Array.isArray(m.chunks) ? (m.chunks as string[]).filter(r => typeof r === 'string') : [];
        const received = refs.filter(r => chunkKeys.has(r)).length;
        const total = refs.length;
        list.push({
          fileId,
          name: (m.originalName as string) ?? fileId.slice(0, 12),
          mime: (m.mime as string) ?? 'unknown',
          totalChunks: total,
          receivedChunks: received,
          size: typeof m.size === 'number' ? m.size : 0,
          percent: total > 0 ? Math.round((received / total) * 100) : 100,
          retrying: false,
          prefs: { paused: false, ignored: false, hostFirst: false },
        });
      }
      setFiles(list);
    } catch { /* noop */ }
  };

  useEffect(() => {
    const loadCounts = async () => {
      const [manifests, chunks] = await Promise.all([
        countStore('manifests'),
        countStore('chunks'),
      ]);
      setDbCounts({ manifests, chunks });
    };
    void loadCounts();
    void loadFiles();

    const poll = setInterval(() => {
      const sm = getSwarmMeshStandalone();
      const bm = getStandaloneBuilderMode();

      const stats = sm.getStats?.();
      if (stats?.assetSync) setAssetSync(stats.assetSync);

      const smPeers = sm.getConnectedPeerIds?.()?.length ?? 0;
      const bmPeers = bm.getConnectedPeerIds?.()?.length ?? 0;
      setPeerCount(Math.max(smPeers, bmPeers));

      const swarm = sm.getTorrentSwarm?.() ?? bm.getTorrentSwarm?.();
      setTorrents(swarm ? swarm.getAllProgress() : []);
    }, 1000);

    const filePoll = setInterval(() => { void loadFiles(); }, 1500);
    const dbPoll = setInterval(() => { void loadCounts(); }, 10_000);

    return () => { clearInterval(poll); clearInterval(filePoll); clearInterval(dbPoll); };
  }, [loadFiles]);

  const handlePref = useCallback((fileId: string, key: 'paused' | 'ignored' | 'hostFirst', value: boolean) => {
    const sm = getSwarmMeshStandalone();
    sm.setFilePref?.(fileId, key, value);
    void loadFiles();
  }, [loadFiles]);

  const handleDelete = useCallback(async (fileId: string) => {
    const sm = getSwarmMeshStandalone();
    await sm.deleteFile?.(fileId);
    void loadFiles();
  }, [loadFiles]);

  const handleReseed = useCallback(async (fileId: string) => {
    const sm = getSwarmMeshStandalone();
    await sm.reseedFile?.(fileId);
    void loadFiles();
  }, [loadFiles]);

  const totalActivity = assetSync.manifestsPulled + assetSync.chunksPulled + assetSync.chunksServed;
  const hasTorrents = torrents.length > 0;
  const sortByPriority = (a: typeof files[number], b: typeof files[number]) => {
    if (a.prefs.hostFirst !== b.prefs.hostFirst) return a.prefs.hostFirst ? -1 : 1;
    return (a.totalChunks ?? Infinity) - (b.totalChunks ?? Infinity);
  };
  const incomplete = files.filter(f => f.percent < 100 && !f.prefs.ignored).sort(sortByPriority);
  const complete = files.filter(f => f.percent === 100).sort(sortByPriority);
  const ignored = files.filter(f => f.prefs.ignored);

  return (
    <Card className="p-4 space-y-4 bg-[hsla(245,70%,8%,0.5)] border-foreground/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-wide uppercase">Content Distribution</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {incomplete.length > 0 && (
            <Badge variant="outline" className="text-[0.6rem] uppercase tracking-widest border-amber-500/40 text-amber-400">
              {incomplete.length} active
            </Badge>
          )}
          {totalActivity > 0 && (
            <Badge variant="outline" className="text-[0.6rem] uppercase tracking-widest border-emerald-500/40 text-emerald-400">
              syncing
            </Badge>
          )}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatBox icon={<Database className="h-3.5 w-3.5 text-sky-400" />} value={dbCounts.manifests} label="Files" />
        <StatBox icon={<Package className="h-3.5 w-3.5 text-[hsl(326,71%,62%)]" />} value={dbCounts.chunks} label="Chunks" />
        <StatBox icon={<ArrowUpFromLine className="h-3.5 w-3.5 text-emerald-400" />} value={assetSync.chunksServed} label="Served" />
        <StatBox icon={<Users className="h-3.5 w-3.5 text-primary" />} value={peerCount} label="Peers" />
      </div>

      {/* Active downloads — torrent-style list */}
      {incomplete.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[0.6rem] uppercase tracking-wider text-foreground/40 flex items-center gap-1.5">
            <ArrowDownToLine className="h-3 w-3" />
            <span>Active Transfers ({incomplete.length})</span>
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {incomplete.map(f => (
              <FileRow key={f.fileId} file={f} onPref={handlePref} />
            ))}
          </div>
        </div>
      )}

      {/* Completed / seeding */}
      {complete.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[0.6rem] uppercase tracking-wider text-foreground/40 flex items-center gap-1.5">
            <ArrowUpFromLine className="h-3 w-3" />
            <span>Seeding ({complete.length})</span>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {complete.map(f => (
              <FileRow key={f.fileId} file={f} onPref={handlePref} compact />
            ))}
          </div>
        </div>
      )}

      {/* Ignored */}
      {ignored.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[0.6rem] uppercase tracking-wider text-foreground/30 flex items-center gap-1.5">
            <Ban className="h-3 w-3" />
            <span>Ignored ({ignored.length})</span>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1 opacity-50">
            {ignored.map(f => (
              <FileRow key={f.fileId} file={f} onPref={handlePref} compact />
            ))}
          </div>
        </div>
      )}

      {/* Pending retries */}
      {assetSync.activeRetries > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-400/80">
          <RefreshCw className="h-3 w-3 animate-spin" />
          <span>{assetSync.activeRetries} asset{assetSync.activeRetries !== 1 ? 's' : ''} retrying</span>
        </div>
      )}

      {/* TorrentSwarm overlay (100MB+ files) */}
      {hasTorrents && (
        <div className="space-y-2 border-t border-foreground/10 pt-3">
          <div className="text-[0.6rem] uppercase tracking-wider text-foreground/40">
            Torrent Swarm Overlay
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {torrents.map(t => (
              <TorrentRow key={t.manifestId} progress={t} />
            ))}
          </div>
        </div>
      )}

      {files.length === 0 && totalActivity === 0 && !hasTorrents && (
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

function FileRow({
  file,
  onPref,
  compact,
}: {
  file: FileTransferInfo;
  onPref: (fileId: string, key: 'paused' | 'ignored' | 'hostFirst', value: boolean) => void;
  compact?: boolean;
}) {
  const isComplete = file.percent === 100;
  const isPaused = file.prefs.paused;
  const isIgnored = file.prefs.ignored;
  const isHostFirst = file.prefs.hostFirst;

  const progressColor = isIgnored
    ? 'bg-foreground/20'
    : isPaused
      ? 'bg-amber-500/60'
      : isComplete
        ? 'bg-emerald-500'
        : 'bg-primary';

  return (
    <div className={cn(
      'rounded-md border border-foreground/10 p-2 space-y-1',
      isPaused && 'border-amber-500/20',
      isIgnored && 'border-foreground/5',
    )}>
      {/* Top row: icon + name + status + controls */}
      <div className="flex items-center gap-2">
        {mimeIcon(file.mime)}
        <span className="text-xs font-mono truncate flex-1 text-foreground/70" title={file.name}>
          {file.name.length > 24 ? file.name.slice(0, 24) + '…' : file.name}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Pause / Resume */}
          {!isComplete && !isIgnored && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title={isPaused ? 'Resume download' : 'Pause download'}
              onClick={() => onPref(file.fileId, 'paused', !isPaused)}
            >
              {isPaused ? <Play className="h-3 w-3 text-emerald-400" /> : <Pause className="h-3 w-3 text-amber-400" />}
            </Button>
          )}
          {/* Ignore forever */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title={isIgnored ? 'Unignore file' : 'Ignore forever'}
            onClick={() => onPref(file.fileId, 'ignored', !isIgnored)}
          >
            <Ban className={cn('h-3 w-3', isIgnored ? 'text-destructive' : 'text-foreground/30')} />
          </Button>
          {/* Host first */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title={isHostFirst ? 'Normal priority' : 'Host first (prioritize seeding)'}
            onClick={() => onPref(file.fileId, 'hostFirst', !isHostFirst)}
          >
            <Star className={cn('h-3 w-3', isHostFirst ? 'text-amber-400 fill-amber-400' : 'text-foreground/30')} />
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      {!compact && (
        <div className="relative">
          <Progress value={file.percent} className="h-1.5 [&>div]:transition-all" />
          <div
            className={cn('absolute inset-0 h-1.5 rounded-full', progressColor)}
            style={{ width: `${file.percent}%` }}
          />
        </div>
      )}

      {/* Stats row */}
      <div className="flex justify-between text-[0.55rem] text-foreground/40">
        <span>
          {file.receivedChunks}/{file.totalChunks} chunks
          {file.size > 0 && ` • ${formatBytes(file.size)}`}
        </span>
        <span className="flex items-center gap-1">
          {file.retrying && <RefreshCw className="h-2.5 w-2.5 animate-spin text-amber-400" />}
          {isPaused && <span className="text-amber-400">PAUSED</span>}
          {isIgnored && <span className="text-destructive">IGNORED</span>}
          {isHostFirst && <span className="text-amber-400">HOST FIRST</span>}
          {isComplete && !isIgnored && <span className="text-emerald-400">SEEDING</span>}
          {!isComplete && !isPaused && !isIgnored && <span>{file.percent}%</span>}
        </span>
      </div>
    </div>
  );
}

function TorrentRow({ progress }: { progress: TorrentProgress }) {
  return (
    <div className="rounded-md border border-foreground/10 p-2 space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <HardDrive className="h-3 w-3 shrink-0 text-primary" />
          <span className="text-xs font-mono truncate text-foreground/70">
            {progress.manifestId.slice(0, 16)}…
          </span>
        </div>
        <Badge variant="outline" className={cn(
          'text-[0.55rem] uppercase tracking-widest',
          progress.state === 'seeding' ? 'text-emerald-400 border-emerald-500/40' : 'text-amber-400 border-amber-500/40'
        )}>
          {progress.state}
        </Badge>
      </div>
      <Progress value={progress.percent} className="h-1.5" />
      <div className="flex justify-between text-[0.55rem] text-foreground/40">
        <span>{progress.receivedChunks}/{progress.totalChunks} chunks • {formatBytes(progress.bytesReceived)}/{formatBytes(progress.bytesTotal)}</span>
        <span>{progress.seeders} seeders</span>
      </div>
    </div>
  );
}
