import { useState, FormEvent } from 'react';
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
import type { BlocklistDirection } from '@/lib/p2p/blocklistStore';

interface BlocklistEntryFormProps {
  onSubmit: (peerId: string, direction: BlocklistDirection, reason?: string | null) => void;
  isSaving: boolean;
}

export function BlocklistEntryForm({ onSubmit, isSaving }: BlocklistEntryFormProps) {
  const [peerId, setPeerId] = useState('');
  const [direction, setDirection] = useState<BlocklistDirection>('all');
  const [reason, setReason] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedPeer = peerId.trim();
    if (!trimmedPeer) {
      return;
    }
    onSubmit(trimmedPeer, direction, reason.trim() ? reason.trim() : null);
    setPeerId('');
    setReason('');
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-md border border-border/40 bg-background/70 p-4">
      <div className="grid gap-1">
        <Label htmlFor="block-peer-id">Peer ID</Label>
        <Input
          id="block-peer-id"
          value={peerId}
          onChange={(event) => setPeerId(event.target.value)}
          placeholder="peer-1234"
          autoComplete="off"
          disabled={isSaving}
        />
      </div>
      <div className="grid gap-1 sm:grid-cols-2 sm:items-end sm:gap-3">
        <div className="grid gap-1">
          <Label htmlFor="block-direction">Direction</Label>
          <Select
            value={direction}
            onValueChange={(value) => setDirection(value as BlocklistDirection)}
            disabled={isSaving}
          >
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
            disabled={isSaving}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!peerId.trim() || isSaving}>Add block</Button>
      </div>
    </form>
  );
}
