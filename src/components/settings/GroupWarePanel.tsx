import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Users, Radio, Check, X, LogOut, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { getGroupWareNode, sanitizeRpcUrl, type GroupWareSnapshot } from '@/lib/groupware/groupwareNode';
import { subscribePersonalServers, type PersonalServer } from '@/lib/storage/providers/personalServerStore';
import type { GroupWarePolicy } from '@/lib/groupware/types';

const POLICIES: { id: GroupWarePolicy; label: string; hint: string }[] = [
  { id: 'approval', label: 'Ask me', hint: 'You approve each person' },
  { id: 'open', label: 'Open', hint: 'Anyone online can join' },
  { id: 'closed', label: 'Closed', hint: 'No new members' },
];

export function GroupWarePanel() {
  const [snap, setSnap] = useState<GroupWareSnapshot | null>(null);
  const [servers, setServers] = useState<PersonalServer[]>([]);
  const [name, setName] = useState('');
  const [serverId, setServerId] = useState('');
  const [policy, setPolicy] = useState<GroupWarePolicy>('approval');
  const [maxMembers, setMaxMembers] = useState(10);
  const [rpcUrl, setRpcUrl] = useState('');

  useEffect(() => getGroupWareNode().subscribe(setSnap), []);
  useEffect(() => subscribePersonalServers(setServers), []);
  useEffect(() => {
    const h = snap?.host;
    if (!h) return;
    setName((n) => n || h.name); setServerId((s) => s || h.serverId);
    setPolicy(h.policy); setMaxMembers(h.maxMembers); setRpcUrl((r) => r || h.rpcUrl || '');
  }, [snap?.host]);

  const node = getGroupWareNode();
  const host = snap?.host;
  const members = host ? Object.keys(host.members) : [];

  const saveConfig = async () => {
    if (!serverId) { toast.error('Pick one of your servers to share'); return; }
    if (rpcUrl.trim() && !sanitizeRpcUrl(rpcUrl)) { toast.error('Network address must be a public https:// link'); return; }
    await node.configureHost({ serverId, name: name.trim() || 'My GroupWare node', policy, maxMembers, rpcUrl });
    toast.success('Sharing settings saved');
  };

  const toggleHosting = async (on: boolean) => {
    try {
      if (on) { await saveConfig(); await node.enableHosting(); toast.success('Your server is now visible on the mesh'); }
      else node.disableHosting();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not start sharing'); }
  };

  return (
    <Card className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start gap-3">
        <Users className="h-5 w-5 mt-0.5 text-primary" />
        <div>
          <h3 className="font-semibold">GroupWare</h3>
          <p className="text-sm text-muted-foreground">
            Share one of your servers with people on the mesh. Your server address and keys stay on your device —
            others only reach it through you, while you're online.
          </p>
        </div>
      </div>

      {/* Host */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-medium">Share my server</h4>
          <Switch checked={!!host?.enabled} onCheckedChange={(v) => void toggleHosting(v)} disabled={servers.length === 0} />
        </div>
        {servers.length === 0 ? (
          <p className="text-xs text-muted-foreground">Link a personal server above first.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              aria-label="Server to share"
            >
              <option value="">Choose a server…</option>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Input placeholder="Name people will see" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              {POLICIES.map((p) => (
                <Button key={p.id} type="button" size="sm" variant={policy === p.id ? 'default' : 'outline'} onClick={() => setPolicy(p.id)} title={p.hint}>
                  {p.label}
                </Button>
              ))}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-muted-foreground">Max people</span>
                <Input type="number" min={1} max={500} className="w-20 h-9" value={maxMembers} onChange={(e) => setMaxMembers(Number(e.target.value) || 1)} />
              </div>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Input placeholder="SWARM network address (optional, https://…/rpc)" value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} maxLength={256} aria-label="SWARM network address" />
              <p className="text-[11px] text-muted-foreground">If your server runs the SWARM network relay, share its public address so your group can add SWARM to MetaMask. Your storage address and keys are never shared.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" className="sm:col-span-2 justify-self-start" onClick={() => void saveConfig()}>Save</Button>
          </div>
        )}

        {host?.enabled && (snap?.pending.length ?? 0) > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium">Waiting for your OK</p>
            {snap!.pending.map((r) => (
              <div key={r.requesterPeerId} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                <span className="truncate">{r.displayName ?? r.requesterPeerId.slice(0, 16)}{r.note ? ` — ${r.note}` : ''}</span>
                <div className="flex gap-1 shrink-0">
                  <Button type="button" size="icon" variant="ghost" aria-label="Approve" onClick={() => void node.approve(r.requesterPeerId)}><Check className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Decline" onClick={() => node.deny(r.requesterPeerId)}><X className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {host && members.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium">Members ({members.length})</p>
            {members.map((m) => (
              <div key={m} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                <span className="truncate font-mono text-xs">{m.slice(0, 20)}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => node.revoke(m)}>Remove</Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Member */}
      <section className="space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2"><Radio className="h-4 w-4" /> Servers on the mesh</h4>
        {(snap?.nodes.length ?? 0) === 0 && (snap?.waitingHosts.length ?? 0) === 0 && (
          <p className="text-xs text-muted-foreground">No shared servers online right now.</p>
        )}
        {snap?.nodes.filter((n) => n.hostPeerId !== undefined).map((n) => {
          const st = snap.status[n.nodeId] ?? 'none';
          return (
            <div key={n.nodeId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{n.name}</p>
                <p className="text-xs text-muted-foreground">{n.memberCount}/{n.maxMembers} people · {POLICIES.find((p) => p.id === n.policy)?.label}</p>
              </div>
              {st === 'member' ? (
                <div className="flex items-center gap-2">
                  <Badge>Joined</Badge>
                  <Button type="button" size="sm" variant="ghost" onClick={() => node.leave(n.nodeId)}><LogOut className="h-4 w-4 mr-1" />Leave</Button>
                </div>
              ) : st === 'pending' || st === 'requesting' ? (
                <Badge variant="secondary">Waiting for host</Badge>
              ) : (
                <Button type="button" size="sm" disabled={n.policy === 'closed'} onClick={() => node.requestAccess(n.nodeId)}>
                  {st === 'denied' ? 'Ask again' : 'Ask to join'}
                </Button>
              )}
            </div>
          );
        })}
        {snap?.waitingHosts.map((p) => (
          <div key={p} className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border p-3">
            <span className="text-xs text-muted-foreground">Shared server nearby ({p.slice(5, 11)})</span>
            <Button type="button" size="sm" variant="outline" onClick={() => node.connectToHost(p)}><Link2 className="h-4 w-4 mr-1" />Connect</Button>
          </div>
        ))}
      </section>
    </Card>
  );
}
