/**
 * BrainsTab — gallery of remixable Project Brain universes.
 *
 * SCAFFOLD STAGE — placeholder grid. Real listing wires into the
 * project-detail / hub registry in a follow-up.
 */
import { Telescope, Sparkles, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

export function BrainsTab() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // SCAFFOLD: starter Brain = the project's main Brain Universe. Remix
  // clones the universe seed into a fresh project (wired in follow-up).
  const handleRemixStarter = () => {
    toast({
      title: 'Starter Brain remix queued',
      description: 'The main Project Brain will be cloned into a fresh project. Wiring lands with the Brains gallery.',
    });
    navigate('/brain');
  };

  const handleSubmitBrain = () => {
    toast({
      title: 'Submit your Brain',
      description: 'Brain submission opens in the next pass. Your current Project Brain will be made remixable from this gallery.',
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground/90">Remixable Brains</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleSubmitBrain}
          className="h-7 gap-1 text-[11px]"
          aria-label="Submit your Project Brain to the Remix gallery"
        >
          <Upload className="h-3.5 w-3.5" />
          Submit Brain
        </Button>
      </div>

      {/* Starter Brain — main Project Brain universe */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <article className="flex flex-col gap-2 rounded-md border border-border/40 bg-background/40 p-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-medium text-primary">
              Starter
            </span>
            <h3 className="text-sm font-medium text-foreground/90">Project Brain</h3>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The main UQRC Brain Universe — Earth, Galaxy, NPCs, and the
            shared village. Remixing clones the seed into a fresh project,
            similar to creating a new project from a template.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleRemixStarter}
              className="h-8 gap-1 text-[11px]"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Remix this Brain
            </Button>
          </div>
        </article>

        <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/40 bg-background/40 p-4 text-center">
          <Telescope className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-[11px] text-muted-foreground">
            More remixable Brains will appear as users submit theirs.
          </p>
        </div>
      </div>
    </div>
  );
}

export default BrainsTab;