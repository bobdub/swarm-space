import { Card } from '@/components/ui/card';
import type { NodeDashboardSnapshot } from '@/hooks/useNodeDashboard';
import type { BlocklistDirection } from '@/lib/p2p/blocklistStore';
import { BlocklistEntryForm } from './blocklists/BlocklistEntryForm';
import { BlocklistTable } from './blocklists/BlocklistTable';
import { BlocklistPersistenceIndicator } from './blocklists/BlocklistPersistenceIndicator';
import { useBlockPersistence } from './blocklists/useBlockPersistence';

interface BlocklistPanelProps {
  snapshot: NodeDashboardSnapshot;
  onBlockPeer: (peerId: string, direction: BlocklistDirection, reason?: string | null) => void;
  onUnblockPeer: (peerId: string, direction?: BlocklistDirection) => void;
}

export function BlocklistPanel({ snapshot, onBlockPeer, onUnblockPeer }: BlocklistPanelProps) {
  const persistence = useBlockPersistence();
  const isSaving = persistence.status === 'saving' || persistence.pendingWrites > 0;

  return (
    <Card className="space-y-5 border-primary/30 bg-background/60 p-5 backdrop-blur">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Block management</h2>
            <BlocklistPersistenceIndicator state={persistence} />
          </div>
          <p className="text-sm text-muted-foreground">
            Persist manual quarantines for inbound and outbound traffic. Entries sync locally and survive reloads.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {snapshot.blocklist.all.length} total entries · {snapshot.blocklist.inbound.length} inbound ·
          {' '}
          {snapshot.blocklist.outbound.length} outbound
        </div>
      </div>

      <BlocklistEntryForm onSubmit={onBlockPeer} isSaving={isSaving} />

      <div className="grid gap-6 md:grid-cols-2">
        <BlocklistTable
          entries={snapshot.blocklist.inbound}
          heading="Inbound blocks"
          emptyCopy="No inbound blocks configured."
          onRemove={(peerId, direction) => onUnblockPeer(peerId, direction)}
        />
        <BlocklistTable
          entries={snapshot.blocklist.outbound}
          heading="Outbound blocks"
          emptyCopy="No outbound blocks configured."
          onRemove={(peerId, direction) => onUnblockPeer(peerId, direction)}
        />
      </div>
    </Card>
  );
}
