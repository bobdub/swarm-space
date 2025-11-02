import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { BlockPersistenceView } from './useBlockPersistence';

interface BlocklistPersistenceIndicatorProps {
  state: BlockPersistenceView;
}

export function BlocklistPersistenceIndicator({ state }: BlocklistPersistenceIndicatorProps) {
  const { status, pendingWrites, lastSyncedLabel, error } = state;

  const icon = (() => {
    if (status === 'saving' || pendingWrites > 0) {
      return <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />;
    }
    if (status === 'error') {
      return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
    }
    return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
  })();

  const label = (() => {
    if (status === 'saving' || pendingWrites > 0) {
      return 'Saving…';
    }
    if (status === 'loading') {
      return 'Loading…';
    }
    if (status === 'error') {
      return error ?? 'Save failed';
    }
    if (lastSyncedLabel) {
      return `Saved ${lastSyncedLabel}`;
    }
    return 'Unsynced changes';
  })();

  const variant = status === 'error' ? 'destructive' : 'outline';

  return (
    <Badge variant={variant} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium">
      {icon}
      <span>{label}</span>
    </Badge>
  );
}
