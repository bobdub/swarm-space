import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  HardDrive, Users, ArrowDownToLine, ArrowUpFromLine, Package,
  RefreshCw, Database, Pause, Play, Ban, Star, FileIcon,
  Image, Music, Film, FileText, Trash2, CheckCircle2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TorrentProgress } from '@/lib/p2p/torrentSwarm.standalone';
import { getTorrentSwarm as getTorrentSwarmSingleton } from '@/lib/p2p/torrentSwarm.standalone';
import { getSwarmMeshStandalone, type AssetSyncStats } from '@/lib/p2p/swarmMesh.standalone';
import { getStandaloneBuilderMode } from '@/lib/p2p/builderMode.standalone-archived';
import { openDB } from '@/lib/store';
import { listVaults, promoteArchivedEntries, type SyncVault, type VaultIndexEntry } from '@/lib/blockchain/syncVault';
import {
  migrateCompletedIntoVaults,
  type MigrationCandidate,
} from '@/lib/blockchain/vaultMigration';
import { getAll } from '@/lib/store';
import type { SwarmCoin } from '@/lib/blockchain/types';
import {
  MEDIA_COIN_CAPACITY_BYTES,
  MEDIA_COIN_SEAL_FRACTION,
  MEDIA_COIN_APPROACHING_FRACTION,
} from '@/lib/blockchain/types';
import { ChevronRight, WifiOff } from 'lucide-react';

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
  seeders: number;
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

// Extends TorrentProgress with the vault-enrolment metadata now carried in
// each persisted manifest snapshot (see torrentSwarm.standalone.ts).
type PersistedTorrentInfo = TorrentProgress & {
  name?: string;
  mime?: string;
  creatorId?: string;
};

// countStore removed — we derive counts from the already-filtered `files` state

export function TorrentSwarmPanel() {
  const [torrents, setTorrents] = useState<TorrentProgress[]>([]);
  const [persistedTorrents, setPersistedTorrents] = useState<PersistedTorrentInfo[]>([]);
  const [assetSync, setAssetSync] = useState<AssetSyncStats>(emptyAssetSync);
  const [peerCount, setPeerCount] = useState(0);
  const [files, setFiles] = useState<FileTransferInfo[]>([]);

  const loadFiles = useCallback(async () => {
    const sm = getSwarmMeshStandalone();
    if (sm.getFileTransferList) {
      try {
        const list = await sm.getFileTransferList();
        setFiles(list.map(f => ({ ...f, owner: (f as any).owner ?? '', createdAt: (f as any).createdAt ?? 0, seeders: (f as any).seeders ?? 0 })));
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
        // Skip paused (flushed) manifests — they are preserved but not actively distributing
        if (m.seedingPaused === true) continue;
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
          seeders: getSwarmMeshStandalone().getFileSeederCount?.(fileId) ?? 0,
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

      const progress: PersistedTorrentInfo[] = entries
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
            name: typeof record.name === 'string' ? (record.name as string) : undefined,
            mime: typeof record.mimeType === 'string' ? (record.mimeType as string) : undefined,
            creatorId: typeof record.creatorId === 'string' ? (record.creatorId as string) : undefined,
          };
        })
        .filter((item) => Boolean(item.manifestId));

      setPersistedTorrents(progress);
    } catch { /* best effort */ }
  }, []);

  const [deadCount, setDeadCount] = useState(0);

  useEffect(() => {
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
        <StatBox icon={<Database className="h-3.5 w-3.5 text-sky-400" />} value={files.length} label="Files" />
        <StatBox icon={<Package className="h-3.5 w-3.5 text-[hsl(326,71%,62%)]" />} value={files.reduce((s, f) => s + f.totalChunks, 0)} label="Chunks" />
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

      {/* Parked while offline — no network calls until a peer connects */}
      {(assetSync.queuedOffline ?? 0) > 0 && (
        <div className="flex items-center gap-2 text-xs text-foreground/50">
          <WifiOff className="h-3 w-3" />
          <span>
            {assetSync.queuedOffline} asset{(assetSync.queuedOffline ?? 0) !== 1 ? 's' : ''} queued —
            waiting for a peer
          </span>
        </div>
      )}

      {/* TorrentSwarm overlay (recordings / large files) */}
      {/* Incoming torrents (retained under Active Transfers grouping) */}
      {hasTorrents && (
        <div className="space-y-2 border-t border-foreground/10 pt-3">
          <div className="flex items-center justify-between">
            <div className="text-[0.6rem] uppercase tracking-wider text-foreground/40">
              Incoming Torrents
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
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {mergedTorrents.map(t => (
              <TorrentRow key={t.manifestId} progress={t} onReseed={handleTorrentReseed} reseedState={reseedingFiles.has(t.manifestId) ? 'spinning' : reseededFiles.has(t.manifestId) ? 'done' : 'idle'} />
            ))}
          </div>
        </div>
      )}

      {/* Peer Vaults — per-peer local storage backed by sealed SWARM coins */}
      <PeerVaultsSection
        completedFiles={complete}
        persistedTorrents={persistedTorrents}
        localPeerId={localPeerId}
        incomingCount={incomplete.length}
      />

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

// ── Peer Vaults ──────────────────────────────────────────────────────────

function PeerVaultsSection({
  completedFiles,
  persistedTorrents,
  localPeerId,
  incomingCount,
}: {
  completedFiles: FileTransferInfo[];
  persistedTorrents: PersistedTorrentInfo[];
  localPeerId: string;
  incomingCount: number;
}) {
  const [vaults, setVaults] = useState<SyncVault[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [completedOpen, setCompletedOpen] = useState<Set<string>>(new Set());
  const [needsCoin, setNeedsCoin] = useState(false);
  const [lastCheck, setLastCheck] = useState<{ enrolled: number; skipped: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setVaults(await listVaults());
    } catch {
      setVaults([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // Idempotent enrolment — every completed file/torrent that isn't yet in a
  // vault gets added on each refresh. `enrollContent` short-circuits on hits.
  // When no wallet coin is free, items land in an Archive coin so nothing is
  // silently dropped.
  useEffect(() => {
    if (completedFiles.length === 0 && persistedTorrents.length === 0) return;
    const selfKey = localPeerId || 'self';
    const candidates: MigrationCandidate[] = [];
    for (const f of completedFiles) {
      if (f.percent !== 100) continue;
      const isSelf = !f.owner || f.owner === localPeerId || f.owner === localPeerId.replace(/^peer-/, '');
      candidates.push({
        contentHash: f.fileId,
        ownerPeerId: isSelf ? selfKey : (f.owner || selfKey),
        isSelf,
        name: f.name,
        mime: f.mime,
        size: f.size,
        ref: f.fileId,
      });
    }
    for (const t of persistedTorrents) {
      if (t.state !== 'seeding' && t.state !== 'complete') continue;
      // Prefer real owner (creatorId) so peer vaults get built when the
      // torrent was received from another peer. Fall back to self only
      // when the persisted snapshot predates the metadata upgrade.
      const owner = t.creatorId && t.creatorId !== localPeerId ? t.creatorId : selfKey;
      const isSelfOwned = owner === selfKey;
      candidates.push({
        contentHash: t.manifestId,
        ownerPeerId: owner,
        isSelf: isSelfOwned,
        name: t.name || t.manifestId,
        mime: t.mime || 'application/x-torrent',
        size: t.bytesTotal,
        ref: t.manifestId,
      });
    }
    (async () => {
      try {
        const r = await migrateCompletedIntoVaults(candidates);
        setNeedsCoin(r.needsCoin);
        setLastCheck({ enrolled: r.enrolled, skipped: r.skipped });
        if (r.enrolled > 0) await refresh();
      } catch (err) {
        console.warn('[PeerVaultsSection] enrol failed', err);
      }
    })();
  }, [completedFiles, persistedTorrents, localPeerId, refresh]);

  const [promoting, setPromoting] = useState(false);
  const promoteArchive = useCallback(async () => {
    setPromoting(true);
    try {
      const coins = (await getAll<SwarmCoin>('swarmCoins').catch(() => []))
        .filter((c) => c.status === 'wallet' && c.fillState !== 'spent');
      if (!coins.length) { setNeedsCoin(true); return; }
      const peers = (await listVaults()).map((v) => v.peerId);
      for (const p of peers) await promoteArchivedEntries(p, coins);
      await refresh();
    } finally {
      setPromoting(false);
    }
  }, [refresh]);

  const toggle = (peerId: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(peerId)) n.delete(peerId); else n.add(peerId);
      return n;
    });
  };

  const sorted = useMemo(
    () => [...vaults].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    [vaults],
  );

  // Cross-vault file counts — Archived (media coin, unwrapped), Wrapped
  // (media coin, wrapped), plus "Incoming" from active downloads.
  const { archivedCount, wrappedCount, totalEntries } = useMemo(() => {
    let archived = 0;
    let wrapped = 0;
    let total = 0;
    for (const v of vaults) {
      const coinMap = new Map(v.coins.map((c) => [c.coinId, c]));
      for (const e of Object.values(v.index)) {
        total += 1;
        const c = coinMap.get(e.coinId);
        if (!c) continue;
        if (c.role === 'media' && c.wrapped) wrapped += 1;
        else if (c.role === 'media' || e.coinId.startsWith('archive:') || e.pending) archived += 1;
      }
    }
    return { archivedCount: archived, wrappedCount: wrapped, totalEntries: total };
  }, [vaults]);

  return (
    <div className="space-y-2 border-t border-foreground/10 pt-3">
      <div className="flex items-center justify-between">
        <div className="text-[0.6rem] uppercase tracking-wider text-foreground/40">
          Peer Vaults
        </div>
        <Badge variant="outline" className="text-[0.55rem] uppercase tracking-widest text-foreground/40 border-foreground/20">
          {sorted.length} peer{sorted.length === 1 ? '' : 's'}
        </Badge>
      </div>

      {/* Cross-vault file counts */}
      <div className="flex flex-wrap gap-1.5 text-[0.55rem]">
        <span className="rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-amber-300/80 uppercase tracking-widest">
          Archived <span className="text-amber-200">{archivedCount}</span>
        </span>
        <span className="rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 text-emerald-300/80 uppercase tracking-widest">
          Wrapped <span className="text-emerald-200">{wrappedCount}</span>
        </span>
        <span className="rounded border border-sky-500/30 bg-sky-500/5 px-1.5 py-0.5 text-sky-300/80 uppercase tracking-widest">
          Incoming <span className="text-sky-200">{incomingCount}</span>
        </span>
        {lastCheck && (
          <span className="rounded border border-foreground/15 px-1.5 py-0.5 text-foreground/50 uppercase tracking-widest" title="Last sweep">
            Checked {totalEntries} · +{lastCheck.enrolled} new · {lastCheck.skipped} dedup
          </span>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-foreground/35">
          No peer vaults created.
          {needsCoin && (
            <span className="block mt-1 text-amber-400/70">
              Mine a SWARM coin to promote archived entries into a coin-backed vault.
            </span>
          )}
        </p>
      ) : (
        <>
        {needsCoin && (
          <div className="flex items-center justify-between rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[0.65rem] text-amber-300/80">
            <span>Some entries are archived — mine a SWARM coin to promote them.</span>
            <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[0.6rem]" disabled={promoting} onClick={() => void promoteArchive()}>
              {promoting ? 'Promoting…' : 'Promote archive'}
            </Button>
          </div>
        )}
        <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
          {sorted.map((v) => {
            const entries = Object.entries(v.index);
            const totalBytes = entries.reduce((s, [, e]) => s + (e.length || 0), 0);
            const pendingCount = entries.reduce((n, [, e]) => n + (e.pending ? 1 : 0), 0);
            const isSelf = v.peerId === (localPeerId || 'self') || v.peerId === localPeerId.replace(/^peer-/, '');
            const label = isSelf ? 'self' : `@${v.peerId.replace(/^peer-/, '').slice(0, 10)}…`;
            const isOpen = expanded.has(v.peerId);
            return (
              <div key={v.peerId} className="rounded-md border border-foreground/10">
                <button
                  type="button"
                  onClick={() => toggle(v.peerId)}
                  className="w-full flex items-center gap-2 p-2 text-left hover:bg-foreground/[0.03] transition-colors"
                >
                  <ChevronRight className={cn('h-3.5 w-3.5 text-foreground/40 transition-transform', isOpen && 'rotate-90')} />
                  <span className="text-xs font-mono text-foreground/70 truncate flex-1">{label}</span>
                  <span className="text-[0.6rem] text-foreground/50 shrink-0">
                    Coins Used: <span className="text-foreground/80">{v.coins.length}</span>
                    {'  '}
                    Media Files: <span className="text-foreground/80">{entries.length}</span>
                    {pendingCount > 0 && (
                      <>{'  '}Pending: <span className="text-amber-400/80">{pendingCount}</span></>
                    )}
                  </span>
                  <span className="text-[0.55rem] text-foreground/40 shrink-0 ml-2">
                    {formatBytes(totalBytes)}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-foreground/10 p-2 space-y-1">
                    {/* Coin math — one row per coin, showing real fill vs 500 MiB cap */}
                    {v.coins.length > 0 && (
                      (() => {
                        const rows = v.coins.map((c) => {
                          const cap = Number.isFinite(c.capacityBytes) ? c.capacityBytes : MEDIA_COIN_CAPACITY_BYTES;
                          const pct = cap > 0 ? Math.min(100, (c.fillBytes / cap) * 100) : 0;
                          const frac = cap > 0 ? c.fillBytes / cap : 0;
                          const state = c.failed
                            ? 'Failed'
                            : c.wrapped
                              ? 'Wrapped'
                              : c.sealed
                                ? 'Sealed'
                                : frac >= MEDIA_COIN_SEAL_FRACTION
                                  ? 'Sealing'
                                  : frac >= MEDIA_COIN_APPROACHING_FRACTION
                                    ? 'Approaching'
                                    : 'Filling';
                          const tone =
                            state === 'Failed' ? 'text-rose-300 border-rose-500/30'
                            : state === 'Wrapped' ? 'text-emerald-300 border-emerald-500/30'
                            : state === 'Sealed' || state === 'Sealing' ? 'text-amber-300 border-amber-500/30'
                            : state === 'Approaching' ? 'text-sky-300 border-sky-500/30'
                            : 'text-foreground/50 border-foreground/15';
                          const short = c.coinId.length > 20 ? c.coinId.slice(0, 12) + '…' + c.coinId.slice(-5) : c.coinId;
                          const done = c.wrapped || c.sealed || c.failed;
                          return { c, cap, pct, state, tone, short, done };
                        });
                        const active = rows.filter((r) => !r.done);
                        const done = rows.filter((r) => r.done);
                        const cOpen = completedOpen.has(v.peerId);
                        return (
                          <div className="space-y-1 pb-1">
                            {active.map((r) => (
                              <div key={r.c.coinId} className="flex items-center gap-2 text-[0.55rem]">
                                <span className="font-mono text-foreground/50 truncate flex-1" title={r.c.coinId}>{r.short}</span>
                                <span className={cn('rounded border px-1 py-[1px] uppercase tracking-widest', r.tone)}>{r.state}</span>
                                <span className="text-foreground/50 shrink-0 tabular-nums">
                                  {formatBytes(r.c.fillBytes)} / {Number.isFinite(r.cap) ? formatBytes(r.cap) : '∞'} ({r.pct.toFixed(0)}%)
                                </span>
                              </div>
                            ))}
                            {done.length > 0 && (
                              <div className="rounded border border-foreground/10">
                                <button
                                  type="button"
                                  onClick={() => setCompletedOpen((prev) => {
                                    const n = new Set(prev);
                                    if (n.has(v.peerId)) n.delete(v.peerId); else n.add(v.peerId);
                                    return n;
                                  })}
                                  className="w-full flex items-center gap-2 px-1.5 py-1 text-left hover:bg-foreground/[0.03] transition-colors"
                                >
                                  <ChevronRight className={cn('h-3 w-3 text-foreground/40 transition-transform', cOpen && 'rotate-90')} />
                                  <span className="text-[0.55rem] uppercase tracking-widest text-foreground/50 flex-1">
                                    Completed coins
                                  </span>
                                  <span className="text-[0.55rem] text-foreground/40">
                                    {done.length}
                                  </span>
                                </button>
                                {cOpen && (
                                  <div className="border-t border-foreground/10 p-1.5 space-y-1">
                                    {done.map((r) => (
                                      <div key={r.c.coinId} className="flex items-center gap-2 text-[0.55rem]">
                                        <span className="font-mono text-foreground/50 truncate flex-1" title={r.c.coinId}>{r.short}</span>
                                        <span className={cn('rounded border px-1 py-[1px] uppercase tracking-widest', r.tone)}>{r.state}</span>
                                        <span className="text-foreground/50 shrink-0 tabular-nums">
                                          {formatBytes(r.c.fillBytes)} / {Number.isFinite(r.cap) ? formatBytes(r.cap) : '∞'} ({r.pct.toFixed(0)}%)
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()
                    )}
                    {entries.length === 0 ? (
                      <p className="text-[0.65rem] text-foreground/30">Vault is empty.</p>
                    ) : (
                      <div className="max-h-56 overflow-y-auto space-y-1">
                        {entries.map(([hash, e]) => (
                          <VaultEntryRow key={hash} hash={hash} entry={e} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}

function VaultEntryRow({ hash, entry }: { hash: string; entry: VaultIndexEntry }) {
  const mime = entry.mime || 'unknown';
  const raw = entry.name || entry.ref || hash;
  const label = raw.length > 28 ? raw.slice(0, 28) + '…' : raw;
  const archived = entry.coinId.startsWith('archive:');
  const pending = entry.pending || archived;
  return (
    <div className="flex items-center gap-2 rounded border border-foreground/5 bg-foreground/[0.02] px-2 py-1">
      {mimeIcon(mime)}
      <span className="text-[0.65rem] font-mono truncate flex-1 text-foreground/70" title={entry.name || hash}>
        {label}
      </span>
      {pending && (
        <span className="text-[0.5rem] uppercase tracking-widest text-amber-400/80 border border-amber-500/30 rounded px-1 py-[1px]">
          {archived ? 'Archive' : 'Pending'}
        </span>
      )}
      <span className="text-[0.55rem] text-foreground/40 shrink-0">
        {formatBytes(entry.length || 0)}
      </span>
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
          <span className={cn("flex items-center gap-0.5", file.seeders > 0 ? "text-sky-400" : "text-foreground/30")}>
            <Users className="h-2.5 w-2.5" />{file.seeders}
          </span>
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
          {/* Re-seed (completed only, ≤15 MB) */}
          {isComplete && onReseed && progress.bytesTotal <= 15 * 1024 * 1024 && (
            <Button variant="ghost" size="icon" className="h-6 w-6" disabled={reseedState === 'spinning'} title={reseedState === 'done' ? 'Re-seed complete!' : 'Re-seed with optimized chunks'} onClick={() => reseedState === 'idle' && onReseed(progress.manifestId)}>
              {reseedState === 'spinning' ? <RefreshCw className="h-3 w-3 text-primary animate-spin" /> : reseedState === 'done' ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <RefreshCw className="h-3 w-3 text-primary/60 hover:text-primary" />}
            </Button>
          )}
          {isComplete && progress.bytesTotal > 15 * 1024 * 1024 && (
            <span className="text-[0.5rem] text-foreground/30 mx-1" title="Re-seeding files over 15 MB is not currently supported">
              &gt;15 MB
            </span>
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
        <span className="flex items-center gap-1">
          <Users className="h-2.5 w-2.5 text-sky-400" />{progress.seeders} seeders
        </span>
      </div>
    </div>
  );
}
