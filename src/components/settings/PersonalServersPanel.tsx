import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Server, Plus, Trash2, Pause, Play, Globe, Lock, RefreshCw, KeyRound, CloudUpload } from 'lucide-react';
import { toast } from 'sonner';
import {
  subscribePersonalServers,
  removePersonalServer,
  updatePersonalServer,
  type PersonalServer,
} from '@/lib/storage/providers/personalServerStore';
import { probePersonalServer } from '@/lib/storage/providers/personalServerProvider';
import { AddPersonalServerWizard } from './AddPersonalServerWizard';
import { getCurrentUser } from '@/lib/auth';
import { hasPersonalServerCredentials } from '@/lib/storage/providers/personalServerSecrets';
import { retryPersonalServerSync } from '@/lib/storage/providers/personalServerSync';

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function PersonalServersPanel() {
  const [servers, setServers] = useState<PersonalServer[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [relinkServer, setRelinkServer] = useState<PersonalServer | null>(null);
  const [credentialState, setCredentialState] = useState<Record<string, boolean>>({});
  const userId = getCurrentUser()?.id ?? '';

  useEffect(() => subscribePersonalServers(setServers), []);
  useEffect(() => {
    let active = true;
    void Promise.all(servers.map(async (server) => [
      server.id,
      await hasPersonalServerCredentials(userId, server.id),
    ] as const)).then((entries) => {
      if (active) setCredentialState(Object.fromEntries(entries));
    });
    return () => { active = false; };
  }, [servers, userId]);

  const handleProbe = async (id: string) => {
    setProbingId(id);
    try {
      const result = await probePersonalServer(id, userId);
      if (result.ok) {
        toast.success('Server healthy', { description: 'write · read · delete all passed' });
      } else {
        const failed = result.steps.find((s) => !s.ok);
        toast.error(`Probe failed at ${failed?.step ?? 'connect'}`, {
          description: failed?.error ?? 'No detail returned by the server.',
          duration: 15000,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error('Probe could not run', {
        description: message || 'An unexpected error interrupted the probe.',
        duration: 15000,
      });
    } finally { setProbingId(null); }
  };

  const handleRemove = (id: string) => {
    if (!confirm('Remove this server? Stored ciphertext on the server itself is not deleted.')) return;
    removePersonalServer(id, userId);
    toast.success('Server removed');
  };

  const openRelink = (server: PersonalServer) => {
    setRelinkServer(server);
    setWizardOpen(true);
  };

  const handleSyncNow = async (server: PersonalServer) => {
    try {
      await retryPersonalServerSync(server.id);
      toast.success('Personal server sync checked');
    } catch (error) {
      toast.error('Sync could not start', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            Personal Servers
          </h2>
          <p className="text-sm text-foreground/60 mt-1">
            Bring-your-own encrypted-only storage. Plaintext, keys, and identity never leave your device.
          </p>
        </div>
        <Button type="button" size="sm" className="gap-2" onClick={() => setWizardOpen(true)}>
          <Plus className="h-3 w-3" /> Add server
        </Button>
      </div>

      {servers.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No personal servers linked yet.
        </p>
      ) : (
        <div className="space-y-3">
          {servers.map((s) => (
            <div key={s.id} className="rounded-xl border border-border/40 bg-background/30 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${s.health?.ok && credentialState[s.id] ? 'bg-primary' : 'bg-muted-foreground'}`} />
                    <span className="font-semibold truncate">{s.name}</span>
                    {s.scope === 'public-pin'
                      ? <span className="inline-flex items-center gap-1 text-xs text-accent"><Globe className="h-3 w-3" />Public pin</span>
                      : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />Private</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{s.kind} · {s.url}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(s.usedBytes)} of {formatBytes(s.capBytes)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.paused
                      ? 'Paused'
                      : !credentialState[s.id]
                        ? 'Relink required'
                        : (s.pendingItems ?? 0) > 0
                          ? `${s.pendingItems} item${s.pendingItems === 1 ? '' : 's'} queued`
                          : s.lastSyncedAt
                            ? `Connected · synced ${new Date(s.lastSyncedAt).toLocaleString()}`
                            : 'Connected'}
                  </p>
                  {s.health?.steps?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.health.steps.map((st) => (
                        <span
                          key={st.step}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            st.ok
                              ? 'bg-primary/15 text-primary'
                              : 'bg-destructive/15 text-destructive'
                          }`}
                        >
                          {st.step} {st.ok ? 'ok' : 'failed'}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {s.health && !s.health.ok && s.health.error ? (
                    <p className="mt-2 break-words text-xs text-destructive/90">{s.health.error}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  {!credentialState[s.id] ? (
                    <Button type="button" size="icon" variant="ghost"
                      onClick={() => openRelink(s)} title="Relink credentials">
                      <KeyRound className="h-3 w-3" />
                    </Button>
                  ) : (
                    <Button type="button" size="icon" variant="ghost"
                      onClick={() => { void handleSyncNow(s); }} title="Sync now">
                      <CloudUpload className="h-3 w-3" />
                    </Button>
                  )}
                  <Button type="button" size="icon" variant="ghost" disabled={probingId === s.id}
                    onClick={() => handleProbe(s.id)} title="Re-probe">
                    <RefreshCw className={`h-3 w-3 ${probingId === s.id ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button type="button" size="icon" variant="ghost"
                    onClick={() => updatePersonalServer(s.id, { paused: !s.paused })}
                    title={s.paused ? 'Resume' : 'Pause'}>
                    {s.paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                  </Button>
                  <Button type="button" size="icon" variant="ghost"
                    onClick={() => handleRemove(s.id)} title="Remove">
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddPersonalServerWizard
        key={relinkServer?.id ?? 'new'}
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) setRelinkServer(null);
        }}
        userId={userId}
        relinkServer={relinkServer}
      />
    </Card>
  );
}