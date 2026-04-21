/**
 * User Cell Controls — trimmed Builder controls for an active cell.
 *
 * Only rendered while a user cell is active. Drops global preferences
 * (shy-node, show-network-content, blockchain-sync, torrent-serving)
 * which live in Settings or inherit SWARM defaults.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Settings2, UserPlus, UserCheck, UserX, Pickaxe } from 'lucide-react';
import { toast } from 'sonner';
import {
  getStandaloneBuilderMode,
  type BuilderToggles,
  type PendingPeer,
  type BuilderPeer,
} from '@/lib/p2p/builderMode.standalone-archived';

interface UserCellControlsProps {
  cellId: string;
}

export function UserCellControls({ cellId }: UserCellControlsProps) {
  const builder = getStandaloneBuilderMode();
  const [toggles, setToggles] = useState<BuilderToggles>(() => builder.getToggles());
  const [pending, setPending] = useState<PendingPeer[]>(() => builder.getPendingPeers());
  const [peers, setPeers] = useState<BuilderPeer[]>([]);
  const [manualId, setManualId] = useState('');

  useEffect(() => {
    const u1 = builder.onToggleChange(setToggles);
    const u2 = builder.onPendingChange(setPending);
    const u3 = builder.onPeersChange(setPeers);
    return () => { u1(); u2(); u3(); };
  }, [builder]);

  const flip = (key: keyof BuilderToggles) => (value: boolean) => {
    builder.setToggle(key, value);
  };

  const handleInvite = () => {
    const id = manualId.trim();
    if (!id) return;
    const ok = builder.connectToPeer(id);
    if (ok) {
      toast.success(`Inviting ${id.slice(0, 12)}…`);
    } else {
      toast.info(`Queued ${id.slice(0, 12)}…`);
    }
    setManualId('');
  };

  return (
    <Card className="bg-card/50 border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-display tracking-wide uppercase">
              Cell Controls
            </CardTitle>
          </div>
          <Badge variant="outline" className="font-mono text-[0.6rem]">
            {cellId}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toggles */}
        <div className="space-y-3">
          <ToggleRow
            label="Build a Mesh"
            hint="Auto-dial peers from your library"
            checked={toggles.buildMesh}
            onChange={flip('buildMesh')}
          />
          <ToggleRow
            label="Approve Only"
            hint="Require manual approval for inbound peers"
            checked={toggles.approveOnly}
            onChange={flip('approveOnly')}
          />
          <ToggleRow
            label="Auto-Connect"
            hint="Reconnect to known peers on startup"
            checked={toggles.autoConnect}
            onChange={flip('autoConnect')}
          />
          <ToggleRow
            label="Mining"
            icon={<Pickaxe className="h-3.5 w-3.5 text-primary" />}
            hint="Mine blocks while connected"
            checked={toggles.mining}
            onChange={flip('mining')}
          />
        </div>

        {/* Approval queue */}
        {pending.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border/40 bg-background/40 p-3">
            <div className="text-xs font-semibold text-foreground/80">
              Approval Queue · {pending.length}
            </div>
            {pending.map((p) => (
              <div key={p.peerId} className="flex items-center justify-between gap-2 text-xs">
                <code className="truncate font-mono text-muted-foreground">{p.peerId}</code>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => builder.approvePeer(p.peerId)}
                    className="h-7 gap-1 px-2"
                    type="button"
                  >
                    <UserCheck className="h-3 w-3" /> Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => builder.rejectPeer(p.peerId)}
                    className="h-7 gap-1 px-2 text-muted-foreground"
                    type="button"
                  >
                    <UserX className="h-3 w-3" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Manual invite */}
        <div className="space-y-2 border-t border-border/30 pt-3">
          <Label className="text-xs text-muted-foreground">Invite by Peer ID</Label>
          <div className="flex gap-2">
            <Input
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder="peer-…"
              className="font-mono text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleInvite}
              disabled={!manualId.trim()}
              className="gap-1.5"
              type="button"
            >
              <UserPlus className="h-3.5 w-3.5" /> Invite
            </Button>
          </div>
        </div>

        {/* Connected peers */}
        <div className="space-y-1 border-t border-border/30 pt-3">
          <div className="text-xs font-semibold text-foreground/80">
            Connected · {peers.length}
          </div>
          {peers.length === 0 ? (
            <div className="text-[0.7rem] text-muted-foreground">No peers in this cell yet.</div>
          ) : (
            <div className="space-y-1">
              {peers.map((p) => (
                <div key={p.peerId} className="flex items-center justify-between text-[0.7rem]">
                  <code className="truncate font-mono text-muted-foreground">{p.peerId}</code>
                  <Badge variant="outline" className="text-[0.55rem]">online</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, hint, icon, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          {icon}
          {label}
        </div>
        {hint && <div className="text-[0.65rem] text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
