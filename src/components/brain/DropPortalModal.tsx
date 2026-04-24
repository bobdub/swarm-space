import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2 } from 'lucide-react';
import { getUserProjects } from '@/lib/projects';
import { getCurrentUser } from '@/lib/auth';
import type { Project } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (projectId: string, projectName: string) => void;
  existingPortalsByProject?: Map<string, string>;
  onDeletePortal?: (projectId: string) => void;
}

export function DropPortalModal({ open, onClose, onConfirm, existingPortalsByProject, onDeletePortal }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const user = await getCurrentUser();
        if (!user) { setProjects([]); return; }
        const list = await getUserProjects();
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
            projects.map((p) => {
              const placed = existingPortalsByProject?.has(p.id) ?? false;
              return (
                <div key={p.id} className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 justify-between"
                    onClick={() => { onConfirm(p.id, p.name); onClose(); }}
                  >
                    <span className="truncate">
                      {placed ? 'Move portal here' : p.name}
                    </span>
                    {placed && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        placed
                      </span>
                    )}
                  </Button>
                  {placed && onDeletePortal && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove portal to ${p.name}`}
                      onClick={() => setConfirmDelete({ id: p.id, name: p.name })}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
        <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove your portal?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove your portal to <strong>{confirmDelete?.name}</strong> from the world.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (confirmDelete && onDeletePortal) onDeletePortal(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}