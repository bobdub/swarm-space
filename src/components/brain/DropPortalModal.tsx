import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getMyProjects } from '@/lib/projects';
import { getCurrentUser } from '@/lib/auth';
import type { Project } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (projectId: string, projectName: string) => void;
}

export function DropPortalModal({ open, onClose, onConfirm }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const user = await getCurrentUser();
        if (!user) { setProjects([]); return; }
        const list = await getMyProjects();
        if (!cancelled) setProjects(list);
      } catch (err) {
        console.warn('[DropPortalModal] failed to load projects:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Drop a portal</DialogTitle>
          <DialogDescription>
            Plant a portal in the brain that warps visitors to one of your project hubs.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-foreground/60">Loading projects…</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-foreground/60">
              You need to be a member of at least one project to drop a portal.
            </p>
          ) : (
            projects.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => { onConfirm(p.id, p.name); onClose(); }}
              >
                {p.name}
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}