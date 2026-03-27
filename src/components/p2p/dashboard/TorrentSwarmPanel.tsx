import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  HardDrive, Users, ArrowDownToLine, ArrowUpFromLine, Package,
  RefreshCw, Database, Pause, Play, Ban, Star, FileIcon,
  Image, Music, Film, FileText, Trash2, CheckCircle2, Eraser, AlertTriangle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { TorrentProgress } from '@/lib/p2p/torrentSwarm.standalone';
import { getTorrentSwarm as getTorrentSwarmSingleton } from '@/lib/p2p/torrentSwarm.standalone';
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
  owner: string;
  createdAt: number;
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
  const [persistedTorrents, setPersistedTorrents] = useState<TorrentProgress[]>([]);
  const [assetSync, setAssetSync] = useState<AssetSyncStats>(emptyAssetSync);
  const [peerCount, setPeerCount] = useState(0);
  const [dbCounts, setDbCounts] = useState({ manifests: 0, chunks: 0 });
  const [files, setFiles] = useState<FileTransferInfo[]>([]);

  const loadFiles = useCallback(async () => {
    const sm = getSwarmMeshStandalone();
    if (sm.getFileTransferList) {
      try {
        const list = await sm.getFileTransferList();
        setFiles(list.map(f => ({ ...f, owner: (f as any).owner ?? '', createdAt: (f as any).createdAt ?? 0 })));
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
        const fileSize = typeof m.size === 'number' ? m.size as number : 0;
        // Fixed 1 MiB chunk size — 1:1 ratio of chunks to file size in MiB (rounded up)
        const total = fileSize > 0 ? Math.max(1, Math.ceil(fileSize / 1_048_576)) : refs.length;
        const scaledReceived = refs.length > 0 && refs.length !== total
          ? Math.min(total, Math.round((received / refs.length) * total))
          : received;
        list.push({
          fileId,
          name: (m.originalName as string) ?? fileId.slice(0, 12),
          mime: (m.mime as string) ?? 'unknown',
          totalChunks: total,
          receivedChunks: scaledReceived,
          size: fileSize,
          percent: total > 0 ? Math.round((scaledReceived / total) * 100) : 100,
          retrying: false,
          owner: (m.owner as string) ?? '',
          createdAt: typeof m.createdAt === 'string' ? new Date(m.createdAt as string).getTime() : (typeof m.createdAt === 'number' ? m.createdAt as number : 0),
          prefs: { paused: false, ignored: false, hostFirst: false },
        });
      }
      setFiles(list);
    } catch { /* noop */ }
  };

  // Load persisted torrent manifests from IndexedDB (survives navigation)
  const loadPersistedTorrents = useCallback(async () => {
    try {
      const db = await openDB();
      if (!db.objectStoreNames.contains('meta')) {
        setPersistedTorrents([]);
        return;
      }

      const entries = await new Promise<Array<{ k?: unknown; v?: unknown }>>((resolve) => {
        const tx = db.transaction('meta', 'readonly');
        const req = tx.objectStore('meta').getAll();
        req.onsuccess = () => resolve((req.result ?? []) as Array<{ k?: unknown; v?: unknown }>);
        req.onerror = () => resolve([]);
      });

      const progress: TorrentProgress[] = entries
        .filter((entry) => typeof entry.k === 'string' && entry.k.startsWith('torrent-manifest:'))
        .map((entry) => {
          const record = (entry.v ?? {}) as Record<string, unknown>;
          const totalChunks = (record.totalChunks as number) ?? 0;
          const receivedChunks = (record.receivedChunks as number) ?? totalChunks;
          return {
            manifestId: (record.id as string) ?? '',
            state: (record.state as TorrentProgress['state']) ?? 'seeding',
            totalChunks,
            receivedChunks,
            availableChunks: receivedChunks,
            percent: totalChunks > 0 ? Math.round((receivedChunks / totalChunks) * 100) : 100,
            bytesReceived: (record.totalSize as number) ?? 0,
            bytesTotal: (record.totalSize as number) ?? 0,
            activePeers: 0,
            seeders: 0,
          };
        })
        .filter((item) => Boolean(item.manifestId));

      setPersistedTorrents(progress);
    } catch { /* best effort */ }
  }, []);

  const [deadCount, setDeadCount] = useState(0);

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
    void loadPersistedTorrents();

    const poll = setInterval(() => {
      const sm = getSwarmMeshStandalone();
      const bm = getStandaloneBuilderMode();

      const stats = sm.getStats?.();
      if (stats?.assetSync) setAssetSync(stats.assetSync);

      const smPeers = sm.getConnectedPeerIds?.()?.length ?? 0;
      const bmPeers = bm.getConnectedPeerIds?.()?.length ?? 0;
      setPeerCount(Math.max(smPeers, bmPeers));

      let swarm = sm.getTorrentSwarm?.() ?? bm.getTorrentSwarm?.();
      if (!swarm) {
        try { swarm = getTorrentSwarmSingleton(); } catch { /* not initialized yet */ }
      }
      setTorrents(swarm ? swarm.getAllProgress() : []);
    }, 1000);

    const filePoll = setInterval(() => { void loadFiles(); }, 1500);
    const dbPoll = setInterval(() => { void loadCounts(); }, 10_000);
    const torrentPoll = setInterval(() => { void loadPersistedTorrents(); }, 5_000);

    // Listen for new torrent manifest persistence events
    const handleManifestPersisted = () => { void loadPersistedTorrents(); };
    window.addEventListener('torrent-manifest-persisted', handleManifestPersisted);

    // Listen for dead-seed auto-cleanup events
    const handleTorrentDead = (e: Event) => {
      const detail = (e as CustomEvent).detail as { manifestId?: string; name?: string } | undefined;
      console.log(`[TorrentSwarmPanel] 💀 Dead torrent cleaned: ${detail?.name ?? detail?.manifestId ?? 'unknown'}`);
      setDeadCount(prev => prev + 1);
      // Reset counter after 10 seconds
      setTimeout(() => setDeadCount(prev => Math.max(0, prev - 1)), 10_000);
      void loadPersistedTorrents();
    };
    window.addEventListener('torrent-dead', handleTorrentDead);

    return () => {
      clearInterval(poll);
      clearInterval(filePoll);
      clearInterval(dbPoll);
      clearInterval(torrentPoll);
      window.removeEventListener('torrent-manifest-persisted', handleManifestPersisted);
      window.removeEventListener('torrent-dead', handleTorrentDead);
    };
  }, [loadFiles, loadPersistedTorrents]);

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

  const [reseedingFiles, setReseedingFiles] = useState<Set<string>>(new Set());
  const [reseededFiles, setReseededFiles] = useState<Set<string>>(new Set());
  const reseededTimers = useRef<Map<string, number>>(new Map());

  const markReseedDone = useCallback((id: string) => {
    setReseededFiles(prev => new Set(prev).add(id));
    const timer = window.setTimeout(() => {
      setReseededFiles(prev => { const n = new Set(prev); n.delete(id); return n; });
      reseededTimers.current.delete(id);
    }, 4000);
    reseededTimers.current.set(id, timer);
  }, []);

  const handleReseed = useCallback(async (fileId: string) => {
    setReseedingFiles(prev => new Set(prev).add(fileId));
    setReseededFiles(prev => { const n = new Set(prev); n.delete(fileId); return n; });
    try {
      const sm = getSwarmMeshStandalone();
      await sm.reseedFile?.(fileId);
      markReseedDone(fileId);
    } catch {
      // silent
    } finally {
      setReseedingFiles(prev => { const n = new Set(prev); n.delete(fileId); return n; });
    }
    void loadFiles();
  }, [loadFiles, markReseedDone]);

  const handleTorrentReseed = useCallback(async (manifestId: string) => {
    setReseedingFiles(prev => new Set(prev).add(manifestId));
    setReseededFiles(prev => { const n = new Set(prev); n.delete(manifestId); return n; });
    try {
      const sm = getSwarmMeshStandalone();
      const swarm = sm.getTorrentSwarm?.() ?? getStandaloneBuilderMode().getTorrentSwarm?.();
      await swarm?.reseed(manifestId);
      markReseedDone(manifestId);
    } catch {
      // silent
    } finally {
      setReseedingFiles(prev => { const n = new Set(prev); n.delete(manifestId); return n; });
    }
  }, [markReseedDone]);

  const totalActivity = assetSync.manifestsPulled + assetSync.chunksPulled + assetSync.chunksServed;

  // Merge in-memory torrents with persisted ones (dedup by manifestId, prefer in-memory)
  const mergedTorrents = useMemo(() => {
    const seen = new Set(torrents.map(t => t.manifestId));
    const fromPersisted = persistedTorrents.filter(t => !seen.has(t.manifestId));
    return [...torrents, ...fromPersisted];
  }, [torrents, persistedTorrents]);
  const hasTorrents = mergedTorrents.length > 0;
  const incomingTorrentCount = mergedTorrents.filter(t => t.state === 'downloading' || t.state === 'paused').length;

  // Get local peer ID for ownership detection
  const localPeerId = getSwarmMeshStandalone().getPeerId?.() ?? '';

  // Content-pattern sort: host-first starred items first, then own content (newest first), then incoming (newest first)
  const sortByContentPattern = (a: FileTransferInfo, b: FileTransferInfo) => {
    // Starred items always on top
    if (a.prefs.hostFirst !== b.prefs.hostFirst) return a.prefs.hostFirst ? -1 : 1;
    // Own content before incoming
    const aOwn = a.owner === localPeerId || a.owner === localPeerId.replace(/^peer-/, '');
    const bOwn = b.owner === localPeerId || b.owner === localPeerId.replace(/^peer-/, '');
    if (aOwn !== bOwn) return aOwn ? -1 : 1;
    // Within same group: newest first
    return (b.createdAt || 0) - (a.createdAt || 0);
  };

  const incomplete = files.filter(f => f.percent < 100 && !f.prefs.ignored).sort(sortByContentPattern);
  const complete = files.filter(f => f.percent === 100).sort(sortByContentPattern);
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
              <FileRow key={f.fileId} file={f} onPref={handlePref} onDelete={handleDelete} />
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
              <FileRow key={f.fileId} file={f} onPref={handlePref} onDelete={handleDelete} onReseed={handleReseed} reseedState={reseedingFiles.has(f.fileId) ? 'spinning' : reseededFiles.has(f.fileId) ? 'done' : 'idle'} compact />
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
              <FileRow key={f.fileId} file={f} onPref={handlePref} onDelete={handleDelete} compact />
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

      {/* TorrentSwarm overlay (recordings / large files) */}
      <div className="space-y-2 border-t border-foreground/10 pt-3">
        <div className="flex items-center justify-between">
          <div className="text-[0.6rem] uppercase tracking-wider text-foreground/40">
            Network Created Content
          </div>
          <div className="flex items-center gap-1.5">
            {deadCount > 0 && (
              <Badge variant="outline" className="text-[0.55rem] uppercase tracking-widest text-destructive/80 border-destructive/30">
                {deadCount} cleaned
              </Badge>
            )}
            <Badge variant="outline" className="text-[0.55rem] uppercase tracking-widest text-foreground/40 border-foreground/20">
              {incomingTorrentCount} incoming
            </Badge>
          </div>
        </div>
        {hasTorrents ? (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {mergedTorrents.map(t => (
              <TorrentRow key={t.manifestId} progress={t} onReseed={handleTorrentReseed} reseedState={reseedingFiles.has(t.manifestId) ? 'spinning' : reseededFiles.has(t.manifestId) ? 'done' : 'idle'} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-foreground/35">No incoming replay torrents yet.</p>
        )}
      </div>

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
  onDelete,
  onReseed,
  reseedState = 'idle',
  compact,
}: {
  file: FileTransferInfo;
  onPref: (fileId: string, key: 'paused' | 'ignored' | 'hostFirst', value: boolean) => void;
  onDelete?: (fileId: string) => void;
  onReseed?: (fileId: string) => void;
  reseedState?: 'idle' | 'spinning' | 'done';
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
          {/* Re-seed (completed files only) */}
          {isComplete && onReseed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={reseedState === 'spinning'}
              title={reseedState === 'done' ? 'Re-seed complete!' : reseedState === 'spinning' ? 'Re-seeding…' : 'Re-seed with optimized chunks'}
              onClick={() => reseedState === 'idle' && onReseed(file.fileId)}
            >
              {reseedState === 'spinning' ? (
                <RefreshCw className="h-3 w-3 text-primary animate-spin" />
              ) : reseedState === 'done' ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              ) : (
                <RefreshCw className="h-3 w-3 text-primary/60 hover:text-primary" />
              )}
            </Button>
          )}
          {/* Delete */}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Delete file and all chunks"
              onClick={() => {
                if (window.confirm(`Delete "${file.name}" and all its chunks?`)) {
                  onDelete(file.fileId);
                }
              }}
            >
              <Trash2 className="h-3 w-3 text-foreground/30 hover:text-destructive" />
            </Button>
          )}
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

function TorrentRow({ progress, onReseed, reseedState = 'idle' }: {
  progress: TorrentProgress;
  onReseed?: (manifestId: string) => void;
  reseedState?: 'idle' | 'spinning' | 'done';
}) {
  const isComplete = progress.state === 'seeding' || progress.state === 'complete';
  const isPaused = progress.state === 'paused';

  const getSwarm = () => {
    const sm = getSwarmMeshStandalone();
    let swarm = sm.getTorrentSwarm?.() ?? getStandaloneBuilderMode().getTorrentSwarm?.();
    if (!swarm) { try { swarm = getTorrentSwarmSingleton(); } catch { /* noop */ } }
    return swarm;
  };

  const handlePause = () => { getSwarm()?.pause(progress.manifestId); };
  const handleResume = () => { getSwarm()?.resume(progress.manifestId); };
  const handleDelete = () => {
    if (!window.confirm(`Delete torrent "${progress.manifestId.slice(0, 16)}…" and all chunks?`)) return;
    getSwarm()?.remove(progress.manifestId);
  };

  return (
    <div className="rounded-md border border-foreground/10 p-2 space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Film className="h-3 w-3 shrink-0 text-rose-400" />
          <span className="text-xs font-mono truncate text-foreground/70">
            {progress.manifestId.slice(0, 16)}…
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Pause / Resume (downloading only) */}
          {!isComplete && (
            <Button variant="ghost" size="icon" className="h-6 w-6" title={isPaused ? 'Resume' : 'Pause'} onClick={isPaused ? handleResume : handlePause}>
              {isPaused ? <Play className="h-3 w-3 text-emerald-400" /> : <Pause className="h-3 w-3 text-amber-400" />}
            </Button>
          )}
          {/* Re-seed (completed only) */}
          {isComplete && onReseed && (
            <Button variant="ghost" size="icon" className="h-6 w-6" disabled={reseedState === 'spinning'} title={reseedState === 'done' ? 'Re-seed complete!' : 'Re-seed with optimized chunks'} onClick={() => reseedState === 'idle' && onReseed(progress.manifestId)}>
              {reseedState === 'spinning' ? <RefreshCw className="h-3 w-3 text-primary animate-spin" /> : reseedState === 'done' ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <RefreshCw className="h-3 w-3 text-primary/60 hover:text-primary" />}
            </Button>
          )}
          {/* Delete */}
          <Button variant="ghost" size="icon" className="h-6 w-6" title="Delete torrent and all chunks" onClick={handleDelete}>
            <Trash2 className="h-3 w-3 text-foreground/30 hover:text-destructive" />
          </Button>
          <Badge variant="outline" className={cn(
            'text-[0.55rem] uppercase tracking-widest ml-1',
            isComplete ? 'text-emerald-400 border-emerald-500/40' : isPaused ? 'text-amber-400 border-amber-500/40' : 'text-sky-400 border-sky-500/40'
          )}>
            {progress.state}
          </Badge>
        </div>
      </div>
      <Progress value={progress.percent} className="h-1.5" />
      <div className="flex justify-between text-[0.55rem] text-foreground/40">
        <span>{progress.receivedChunks}/{progress.totalChunks} chunks • {formatBytes(progress.bytesReceived)}/{formatBytes(progress.bytesTotal)}</span>
        <span>{progress.seeders} seeders</span>
      </div>
    </div>
  );
}
