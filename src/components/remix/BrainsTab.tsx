/**
 * BrainsTab — public registry of submitted Project Brains.
 *
 * Project-agnostic: regardless of which project the user came from, this
 * tab lists every published Brain in the network. The `Submit a Brain`
 * popover lets the current user publish one of their own projects; only
 * the creator sees a Remove button on their own card.
 */
import { useEffect, useState } from 'react';
import { Telescope } from 'lucide-react';
import {
  hydrateBrainSubmissions,
  subscribeBrainSubmissions,
  type BrainSubmission,
} from '@/lib/remix/brainSubmissionsStore';
import { getCurrentUser } from '@/lib/auth';
import { SubmitBrainPopover } from './SubmitBrainPopover';
import { BrainSubmissionCard } from './BrainSubmissionCard';

export function BrainsTab() {
  const [items, setItems] = useState<BrainSubmission[]>([]);
  const currentUserId = getCurrentUser()?.id ?? null;

  useEffect(() => {
    void hydrateBrainSubmissions();
    return subscribeBrainSubmissions(setItems);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-foreground/90">Public Brains</h2>
          <p className="text-[11px] text-muted-foreground">
            Remix, join, or like Brains submitted by anyone in the network.
          </p>
        </div>
        <SubmitBrainPopover />
      </div>

      {items.length === 0 ? (
        <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/40 bg-background/40 p-6 text-center">
          <Telescope className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-[11px] text-muted-foreground">
            No Brains submitted yet. Click <strong>Submit a Brain</strong> to publish one of your projects.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <BrainSubmissionCard key={s.id} submission={s} currentUserId={currentUserId} />
          ))}
        </div>
      )}
    </div>
  );
}

export default BrainsTab;