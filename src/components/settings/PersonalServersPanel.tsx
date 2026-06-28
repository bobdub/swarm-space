import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Server, Plus, Trash2, Pause, Play, Globe, Lock, RefreshCw } from 'lucide-react';
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
  const userId = getCurrentUser()?.id ?? '';

  useEffect(() => subscribePersonalServers(setServers), []);

  const handleProbe = async (id: string) => {
    setProbingId(id);
    try {
      const result = await probePersonalServer(id, userId);
      toast[result.ok ? 'success' : 'error'](result.ok ? 'Server healthy' : 'Probe failed');
    } finally { setProbingId(null); }
  };

  const handleRemove = (id: string) => {
    if (!confirm('Remove this server? Stored ciphertext on the server itself is not deleted.')) return;
    removePersonalServer(id);
    toast.success('Server removed');
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
                    <span className={`h-2 w-2 rounded-full ${s.health?.ok ? 'bg-green-500' : 'bg-yellow-500'}`} />
                    <span className="font-semibold truncate">{s.name}</span>
                    {s.scope === 'public-pin'
                      ? <span className="inline-flex items-center gap-1 text-xs text-accent"><Globe className="h-3 w-3" />Public pin</span>
                      : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />Private</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{s.kind} · {s.url}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(s.usedBytes)} of {formatBytes(s.capBytes)}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
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

      <AddPersonalServerWizard open={wizardOpen} onOpenChange={setWizardOpen} userId={userId} />
    </Card>
  );
}