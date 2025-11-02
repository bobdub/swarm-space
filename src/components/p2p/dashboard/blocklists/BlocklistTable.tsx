import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { BlocklistEntry, BlocklistDirection } from '@/lib/p2p/blocklistStore';

interface BlocklistTableProps {
  entries: BlocklistEntry[];
  heading: string;
  emptyCopy: string;
  onRemove: (peerId: string, direction: BlocklistDirection) => void;
}

export function BlocklistTable({ entries, heading, emptyCopy, onRemove }: BlocklistTableProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{heading}</h3>
        <span className="text-xs text-muted-foreground">{entries.length} entries</span>
      </div>
      <ScrollArea className="max-h-60 rounded-md border border-border/40 bg-background/70">
        <div className="divide-y divide-border/30 text-sm">
          {entries.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">{emptyCopy}</p>
          ) : (
            entries.map((entry) => (
              <div key={`${entry.peerId}:${entry.direction}`} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="break-all text-sm font-medium">{entry.peerId}</p>
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
                  onClick={() => onRemove(entry.peerId, entry.direction)}
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
}
