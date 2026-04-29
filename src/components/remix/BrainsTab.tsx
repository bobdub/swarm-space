/**
 * BrainsTab — gallery of remixable Project Brain universes.
 *
 * SCAFFOLD STAGE — placeholder grid. Real listing wires into the
 * project-detail / hub registry in a follow-up.
 */
import { Telescope } from 'lucide-react';

export function BrainsTab() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border/40 bg-background/40 p-8 text-center">
      <Telescope className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-sm font-medium text-foreground/90">Brains coming online</h2>
      <p className="max-w-md text-xs text-muted-foreground">
        Remix entire Project Brain universes into a fresh project. The gallery
        and one-click clone flow attach in the next pass — for now the Lab is
        the live surface.
      </p>
    </div>
  );
}

export default BrainsTab;