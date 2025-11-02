import { useState, FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { NodeDashboardSnapshot } from '@/hooks/useNodeDashboard';
import type { BlocklistDirection } from '@/lib/p2p/blocklistStore';

interface BlocklistPanelProps {
  snapshot: NodeDashboardSnapshot;
  onBlockPeer: (peerId: string, direction: BlocklistDirection, reason?: string | null) => void;
  onUnblockPeer: (peerId: string, direction?: BlocklistDirection) => void;
}

export function BlocklistPanel({ snapshot, onBlockPeer, onUnblockPeer }: BlocklistPanelProps) {
  const [peerId, setPeerId] = useState('');
  const [direction, setDirection] = useState<BlocklistDirection>('all');
  const [reason, setReason] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!peerId.trim()) {
      return;
    }
    onBlockPeer(peerId.trim(), direction, reason.trim() ? reason.trim() : null);
    setPeerId('');
    setReason('');
  };

  const renderTable = (entries = snapshot.blocklist.all, heading: string, emptyCopy: string) => {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium">{heading}</h3>
        <ScrollArea className="max-h-56 rounded-md border border-border/40 bg-background/70">
          <div className="divide-y divide-border/30 text-sm">
            {entries.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">{emptyCopy}</p>
            ) : (
              entries.map((entry) => (
                <div key={`${entry.peerId}:${entry.direction}`} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-all">{entry.peerId}</p>
                    <p className="text-xs text-muted-foreground">
                      Direction: {entry.direction}
                      {entry.reason ? ` · ${entry.reason}` : ''}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Added {new Date(entry.addedAt).toLocaleString()}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => onUnblockPeer(entry.peerId, entry.direction)}
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    );
  };

  return (
    <Card className="space-y-4 border-primary/30 bg-background/60 p-5 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Block management</h2>
          <p className="text-sm text-muted-foreground">
            Add or remove peers from inbound and outbound blocklists without leaving the networking panel.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">{snapshot.blocklist.all.length} total entries</p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3 rounded-md border border-border/40 bg-background/70 p-4">
        <div className="grid gap-1">
          <Label htmlFor="block-peer-id">Peer ID</Label>
          <Input
            id="block-peer-id"
            value={peerId}
            onChange={(event) => setPeerId(event.target.value)}
            placeholder="peer-1234"
            autoComplete="off"
          />
        </div>
        <div className="grid gap-1 sm:grid-cols-2 sm:items-end sm:gap-3">
          <div className="grid gap-1">
            <Label htmlFor="block-direction">Direction</Label>
            <Select value={direction} onValueChange={(value) => setDirection(value as BlocklistDirection)}>
              <SelectTrigger id="block-direction" aria-label="Select block direction">
                <SelectValue placeholder="All traffic" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All traffic</SelectItem>
                <SelectItem value="inbound">Inbound only</SelectItem>
                <SelectItem value="outbound">Outbound only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="block-reason">Reason (optional)</Label>
            <Input
              id="block-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Manual quarantine, spam, etc."
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={!peerId.trim()}>Add block</Button>
        </div>
      </form>

      <div className="grid gap-6 md:grid-cols-2">
        {renderTable(snapshot.blocklist.inbound, 'Inbound blocks', 'No inbound blocks configured.')}
        {renderTable(snapshot.blocklist.outbound, 'Outbound blocks', 'No outbound blocks configured.')}
      </div>
    </Card>
  );
}
