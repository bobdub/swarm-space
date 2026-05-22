/**
 * SubmitBrainPopover — pick one of the user's projects to publish on the
 * public Brains gallery. Shown from the BrainsTab header button.
 */
import { useEffect, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Upload, Brain } from 'lucide-react';
import { getUserProjects } from '@/lib/projects';
import { getCurrentUser } from '@/lib/auth';
import {
  submitBrain,
  listBrainSubmissions,
} from '@/lib/remix/brainSubmissionsStore';
import { useToast } from '@/hooks/use-toast';
import type { Project } from '@/types';

export function SubmitBrainPopover() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await getUserProjects();
        if (!cancelled) setProjects(list);
      } catch (err) {
        console.warn('[SubmitBrainPopover] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const existingIds = new Set(
    listBrainSubmissions().map((s) => s.projectId),
  );

  const handleSubmit = async () => {
    if (!picked || submitting) return;
    const project = projects.find((p) => p.id === picked);
    if (!project) return;
    const user = getCurrentUser();
    setSubmitting(true);
    try {
      await submitBrain({
        projectId: project.id,
        projectName: project.name,
        projectDescription: project.description,
        actorId: user?.id ?? 'local',
        actorHandle: user?.displayName || user?.username,
      });
      toast({
        title: 'Brain submitted',
        description: `${project.name} is now listed in the public Brains gallery.`,
      });
      setOpen(false);
      setPicked(null);
    } catch (err) {
      toast({
        title: 'Submit failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-[11px]"
          aria-label="Submit a Brain to the public gallery"
        >
          <Upload className="h-3.5 w-3.5" />
          Submit a Brain
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div role="form" className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <Brain className="mt-[2px] h-4 w-4 text-primary" aria-hidden="true" />
            <p className="text-[11px] leading-snug text-muted-foreground">
              Select a project to list its Brain simulation as a public,
              remixable Brain. Other users can remix it into a fresh project,
              join the live frame, or like it. Only you can remove it later.
            </p>
          </div>

          <div className="max-h-56 overflow-y-auto rounded-md border border-border/40 bg-background/40">
            {loading ? (
              <div className="p-2 text-[11px] text-muted-foreground">Loading projects…</div>
            ) : projects.length === 0 ? (
              <div className="p-2 text-[11px] text-muted-foreground">
                You have no projects yet. Create one first.
              </div>
            ) : (
              <ul className="divide-y divide-border/30">
                {projects.map((p) => {
                  const already = existingIds.has(p.id);
                  return (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-muted/30">
                        <input
                          type="radio"
                          name="brain-project"
                          value={p.id}
                          checked={picked === p.id}
                          onChange={() => setPicked(p.id)}
                          disabled={already}
                          className="h-3 w-3"
                        />
                        <span className="flex-1 truncate text-[11px] text-foreground/90">
                          {p.name}
                        </span>
                        {already && (
                          <span className="rounded-full bg-muted/50 px-1.5 py-[1px] text-[9px] text-muted-foreground">
                            listed
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!picked || submitting}
              onClick={handleSubmit}
              className="h-7 gap-1 text-[11px]"
            >
              <Upload className="h-3.5 w-3.5" />
              {submitting ? 'Submitting…' : 'Submit'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default SubmitBrainPopover;