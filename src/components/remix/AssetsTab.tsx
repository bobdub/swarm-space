/**
 * AssetsTab — gallery of minted Lab assets (molecules, structures).
 *
 * SCAFFOLD STAGE — placeholder. The asset store + media-coin mint
 * pipeline lands in the follow-up that activates the field tick.
 */
import { Atom } from 'lucide-react';

export function AssetsTab() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border/40 bg-background/40 p-8 text-center">
      <Atom className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-sm font-medium text-foreground/90">No assets yet</h2>
      <p className="max-w-md text-xs text-muted-foreground">
        Mint a molecule in the Lab and it will appear here, ready to drop into
        a Project Brain or remix again.
      </p>
    </div>
  );
}

export default AssetsTab;