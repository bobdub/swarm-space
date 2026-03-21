import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Wifi, WifiOff, Loader2, FlaskConical, Users, Package, Clock,
  RefreshCw, PlugZap, Copy, Check, Send, ArrowDownToLine
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  type TestModePhase,
  type TestModePeer,
  type TestModeStats,
  type ContentItem,
  getTestMode,
} from '@/lib/p2p/testMode.standalone';

const PHASE_LABELS: Record<TestModePhase, string> = {
  off: 'Offline',
  connecting: 'Connecting…',
  online: 'Online',
  reconnecting: 'Reconnecting…',
  failed: 'Failed',
};

const PHASE_COLORS: Record<TestModePhase, string> = {
  off: 'text-muted-foreground border-muted',
  connecting: 'text-amber-400 border-amber-500/40',
  online: 'text-emerald-400 border-emerald-500/40',
  reconnecting: 'text-amber-400 border-amber-500/40',
  failed: 'text-destructive border-destructive/40',
};

function truncateContent(data: unknown): string {
  if (!data || typeof data !== 'object') return String(data ?? '');
  const obj = data as Record<string, unknown>;
  const content = (obj.content as string) ?? (obj.text as string) ?? '';
  if (content.length > 80) return content.slice(0, 80) + '…';
  return content || JSON.stringify(data).slice(0, 60);
}

export function TestModePanel() {
  const [phase, setPhase] = useState<TestModePhase>('off');
  const [peers, setPeers] = useState<TestModePeer[]>([]);
  const [stats, setStats] = useState<TestModeStats | null>(null);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [peerInput, setPeerInput] = useState('');
  const [copied, setCopied] = useState(false);
  const statsInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const tm = getTestMode();

  // Subscribe to events
  useEffect(() => {
    const unsubs = [
      tm.onPhaseChange((p) => {
        setPhase(p);
        setStats(tm.getStats());
      }),
      tm.onPeersChange((p) => {
        setPeers(p);
        setStats(tm.getStats());
      }),
      tm.onContentChange((items) => {
        setContentItems(items);
      }),
      tm.onAlert((msg, level) => {
        if (level === 'error') toast.error(msg, { id: 'test-mode-alert' });
        else if (level === 'warn') toast.warning(msg, { id: 'test-mode-alert' });
        else toast.info(msg, { id: 'test-mode-alert' });
      }),
    ];

    setStats(tm.getStats());
    setContentItems(tm.getContent());

    // Poll stats every 2s for uptime counter
    statsInterval.current = setInterval(() => {
      if (tm.getPhase() !== 'off') setStats(tm.getStats());
    }, 2000);

    return () => {
      unsubs.forEach(fn => fn());
      if (statsInterval.current) clearInterval(statsInterval.current);
    };
  }, [tm]);

  const handleToggle = useCallback(async () => {
    if (phase === 'connecting' || phase === 'reconnecting') {
      tm.stop();
    } else if (phase === 'online') {
      tm.stop();
    } else {
      await tm.start();
    }
  }, [phase, tm]);

  const handleConnect = useCallback(() => {
    const id = peerInput.trim();
    if (!id) return;

    // Resolve: if it's a 16-char hex, prefix with peer-
    const resolved = /^[a-f0-9]{16}$/i.test(id) ? `peer-${id}` : id;
    tm.connectToPeer(resolved);
    toast.info(`Connecting to ${resolved}…`);
    setPeerInput('');
  }, [peerInput, tm]);

  const handleSendTestPost = useCallback(() => {
    const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    tm.addContent({
      id,
      type: 'post',
      data: {
        id,
        author: tm.getNodeId(),
        authorName: `Node ${tm.getNodeId().slice(0, 6)}`,
        type: 'text',
        content: `Test post from ${tm.getPeerId()} at ${new Date().toLocaleTimeString()}`,
        createdAt: new Date().toISOString(),
      },
      author: tm.getNodeId(),
      timestamp: Date.now(),
    });
    toast.success('Test post created & broadcast');
  }, [tm]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(tm.getPeerId()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [tm]);

  const formatUptime = (ms: number): string => {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
  };

  const isActive = phase === 'online' || phase === 'connecting' || phase === 'reconnecting';

  // Show most recent content first, limit to 20
  const recentContent = [...contentItems]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20);

  return (
    <Card className="border-primary/20 bg-primary/5 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <FlaskConical className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-bold uppercase tracking-wider">Test Mode</h3>
          <Badge
            variant="outline"
            className={cn('text-[0.6rem] uppercase tracking-widest', PHASE_COLORS[phase])}
          >
            {PHASE_LABELS[phase]}
          </Badge>
        </div>
        <Button
          size="sm"
          variant={isActive ? 'outline' : 'default'}
          onClick={handleToggle}
          className="gap-1.5"
        >
          {phase === 'connecting' || phase === 'reconnecting' ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cancel</>
          ) : phase === 'online' ? (
            <><WifiOff className="h-3.5 w-3.5" /> Stop</>
          ) : (
            <><Wifi className="h-3.5 w-3.5" /> Start</>
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Isolated P2P test harness — stable IDs, dynamic reconnect (15s → 30s → 60s → fail), content sync.
        Posts are loaded from your local database and synced with connected peers.
      </p>

      {/* Identity */}
      <div className="rounded-md border border-foreground/10 bg-background/50 p-3 space-y-1.5">
        <div className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">Your Peer ID</div>
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono text-foreground/80 flex-1 truncate">{tm.getPeerId()}</code>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopyId}>
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats && phase !== 'off' && (
        <div className="grid grid-cols-3 gap-2">
          <div className="flex items-center gap-2 rounded-md border border-foreground/10 bg-background/40 p-2">
            <Users className="h-3.5 w-3.5 text-primary" />
            <div>
              <div className="text-sm font-bold leading-none">{stats.connectedPeers}</div>
              <div className="text-[0.55rem] uppercase tracking-wider text-muted-foreground mt-0.5">Peers</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-foreground/10 bg-background/40 p-2">
            <Package className="h-3.5 w-3.5 text-primary" />
            <div>
              <div className="text-sm font-bold leading-none">{stats.contentItems}</div>
              <div className="text-[0.55rem] uppercase tracking-wider text-muted-foreground mt-0.5">Content</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-foreground/10 bg-background/40 p-2">
            <Clock className="h-3.5 w-3.5 text-primary" />
            <div>
              <div className="text-sm font-bold leading-none">{formatUptime(stats.uptimeMs)}</div>
              <div className="text-[0.55rem] uppercase tracking-wider text-muted-foreground mt-0.5">Uptime</div>
            </div>
          </div>
        </div>
      )}

      {/* Reconnect indicator */}
      {phase === 'reconnecting' && stats && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-amber-400">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Reconnect attempt {stats.reconnectAttempt}/3
        </div>
      )}

      {/* Failed state */}
      {phase === 'failed' && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-2.5 text-xs text-destructive">
          <WifiOff className="h-3.5 w-3.5" />
          Connection failed. Try refreshing your browser.
        </div>
      )}

      {/* Manual connect + Send test post */}
      {phase === 'online' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={peerInput}
              onChange={(e) => setPeerInput(e.target.value)}
              placeholder="Peer ID or Node ID to connect…"
              className="text-xs h-8 bg-background/50"
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            />
            <Button size="sm" variant="outline" onClick={handleConnect} disabled={!peerInput.trim()} className="gap-1.5 h-8">
              <PlugZap className="h-3 w-3" /> Connect
            </Button>
          </div>
          <Button size="sm" variant="secondary" onClick={handleSendTestPost} className="gap-1.5 w-full h-8">
            <Send className="h-3 w-3" /> Send Test Post
          </Button>
        </div>
      )}

      {/* Connected peers list */}
      {peers.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">Connected Peers</div>
          <div className="space-y-1">
            {peers.map(peer => (
              <div key={peer.peerId} className="flex items-center justify-between rounded border border-foreground/10 bg-background/30 px-2.5 py-1.5">
                <code className="text-[0.65rem] font-mono text-foreground/70 truncate max-w-[200px]">{peer.peerId}</code>
                <div className="flex items-center gap-3 text-[0.55rem] text-muted-foreground">
                  <span>↓{peer.messagesReceived}</span>
                  <span>↑{peer.messagesSent}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Log */}
      {recentContent.length > 0 && phase !== 'off' && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <ArrowDownToLine className="h-3 w-3 text-muted-foreground" />
            <span className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
              Content Store ({contentItems.length} items)
            </span>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {recentContent.map(item => (
              <div
                key={item.id}
                className="flex items-start justify-between rounded border border-foreground/10 bg-background/30 px-2.5 py-1.5 gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[0.5rem] px-1 py-0 h-3.5">
                      {item.type}
                    </Badge>
                    <span className="text-[0.55rem] text-muted-foreground">
                      {item.author.slice(0, 8)}…
                    </span>
                  </div>
                  <div className="text-[0.65rem] text-foreground/70 mt-0.5 truncate">
                    {truncateContent(item.data)}
                  </div>
                </div>
                <span className="text-[0.5rem] text-muted-foreground whitespace-nowrap">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
