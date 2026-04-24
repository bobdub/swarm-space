/**
 * User Cells Panel — on-demand private mesh management.
 *
 * Replaces the always-on Builder Mode panel. The Builder engine only loads
 * when the user enters a cell here.
 */

import { useEffect, useState } from 'react';
import { Plus, LogIn, LogOut, Copy, Trash2, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  createUserCell,
  enterUserCell,
  exitUserCell,
  joinUserCellById,
  deleteUserCell,
  onCellsChange,
  onActiveCellChange,
  type UserCell,
} from '@/lib/p2p/userCell';

function formatRelative(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function UserCellsPanel() {
  const [cells, setCells] = useState<UserCell[]>([]);
  const [active, setActive] = useState<UserCell | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u1 = onCellsChange(setCells);
    const u2 = onActiveCellChange(setActive);
    return () => { u1(); u2(); };
  }, []);

  const handleCreate = async () => {
    setBusy(true);
    try {
      const cell = await createUserCell(name);
      toast.success(`Cell created: ${cell.cellId}`, {
        action: {
          label: 'Copy ID',
          onClick: () => navigator.clipboard.writeText(cell.cellId),
        },
      });
      setName('');
      setCreateOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create cell');
    } finally {
      setBusy(false);
    }
  };

  const handleEnter = async (cell: UserCell) => {
    setBusy(true);
    try {
      await enterUserCell(cell.cellId);
      toast.success(`Entered cell ${cell.cellId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to enter cell');
    } finally {
      setBusy(false);
    }
  };

  const handleExit = async () => {
    setBusy(true);
    try {
      await exitUserCell();
      toast.info('Returned to SWARM');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    if (!joinId.trim()) return;
    setBusy(true);
    try {
      const cell = await joinUserCellById(joinId);
      toast.success(`Joined cell ${cell.cellId}`);
      setJoinId('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid cell ID');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (cell: UserCell) => {
    deleteUserCell(cell.cellId);
    toast.info(`Removed ${cell.cellId}`);
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success('Cell ID copied');
  };

  return (
    <Card className="bg-card/50 border-border/40">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-display tracking-wide uppercase">
            User Cells
          </CardTitle>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Create Cell
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {cells.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/40 p-4 text-center text-xs text-muted-foreground">
            No cells yet. Create one to host a private mesh — invite friends with the cell ID.
          </div>
        ) : (
          <div className="space-y-2">
            {cells.map((cell) => {
              const isActive = active?.cellId === cell.cellId;
              return (
                <div
                  key={cell.cellId}
                  className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{cell.name}</span>
                      {cell.ownerUsername && (
                        <Badge variant="outline" className="border-primary/30 text-primary/80 text-[0.6rem]">
                          @{cell.ownerUsername}
                        </Badge>
                      )}
                      {isActive && (
                        <Badge variant="outline" className="border-primary/40 text-primary text-[0.6rem]">
                          ACTIVE
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[0.65rem] text-muted-foreground">
                      <code className="font-mono">{cell.cellId}</code>
                      <button
                        onClick={() => copyId(cell.cellId)}
                        className="hover:text-foreground"
                        type="button"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <span>· entered {formatRelative(cell.lastEnteredAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isActive ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleExit}
                        disabled={busy}
                        className="gap-1.5"
                      >
                        <LogOut className="h-3 w-3" /> Exit
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleEnter(cell)}
                        disabled={busy}
                        className="gap-1.5"
                      >
                        <LogIn className="h-3 w-3" /> Enter
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDelete(cell)}
                      disabled={busy || isActive}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      type="button"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2 border-t border-border/30 pt-3">
          <Label className="text-xs text-muted-foreground">Join Cell by ID</Label>
          <div className="flex gap-2">
            <Input
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              placeholder="u/username/xxxx"
              className="font-mono text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleJoin}
              disabled={busy || !joinId.trim()}
              type="button"
            >
              Join
            </Button>
          </div>
          <p className="text-[0.6rem] text-muted-foreground/70">
            New cells anchor on the owner's @username, so they stay reachable even after peer-id rotation. Legacy <code>8hex-4hex</code> IDs are still accepted.
          </p>
        </div>
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User Cell</DialogTitle>
            <DialogDescription>
              A private mesh you own. Share the cell ID with peers to invite them in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cell-name">Cell name (optional)</Label>
            <Input
              id="cell-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Studio Friends"
              maxLength={48}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} type="button">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={busy} type="button">
              Create Cell
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
