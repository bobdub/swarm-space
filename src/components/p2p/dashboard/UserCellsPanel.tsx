/**
 * User Cells Panel — on-demand private mesh management.
 *
 * Replaces the always-on Builder Mode panel. The Builder engine only loads
 * when the user enters a cell here.
 */

import { useEffect, useState } from 'react';
import { Plus, LogIn, LogOut, Copy, Trash2, Users, Link2, Share2, Globe, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getCurrentUser } from '@/lib/auth';
import { canNativeShare, copyCellInvite, myCellInviteUrl, shareCellInvite } from '@/lib/p2p/cellShare';
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
  toggleCellPublic,
  CELL_NAME_MAX,
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
  const [nameTouched, setNameTouched] = useState(false);
  const nameMissing = !name.trim();
  const myUserId = getCurrentUser()?.id ?? null;

  useEffect(() => {
    const u1 = onCellsChange(setCells);
    const u2 = onActiveCellChange(setActive);
    return () => { u1(); u2(); };
  }, []);

  const handleCreate = async () => {
    setNameTouched(true);
    if (nameMissing) return;
    setBusy(true);
    try {
      const cell = await createUserCell(name);
      toast.success(`Cell created: ${cell.name}`, {
        description: cell.cellId,
        action: {
          label: 'Copy invite link',
          onClick: () => void copyCellInvite(myCellInviteUrl(cell.cellId)),
        },
      });
      setName('');
      setNameTouched(false);
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
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    if (!joinId.trim()) return;
    setBusy(true);
    try {
      await joinUserCellById(joinId);
      setJoinId('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid cell ID');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (cell: UserCell) => {
    deleteUserCell(cell.cellId);
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success('Cell ID copied');
  };

  const handlePublic = (cell: UserCell, next: boolean) => {
    try {
      toggleCellPublic(cell.cellId, next);
      toast.success(next ? `${cell.name} is now public` : `${cell.name} is private again`, {
        description: next
          ? 'Listed in Explore. Live cell posts also reach the main mesh.'
          : 'Removed from Explore. Cell content stays inside the cell.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change visibility');
    }
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
            No cells yet. Create one to host a private mesh, then invite friends with its link.
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
                      {cell.isPublic && (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-500 text-[0.6rem]">
                          PUBLIC
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[0.65rem] text-muted-foreground">
                      <code className="font-mono">{cell.cellId}</code>
                      <button
                        onClick={() => copyId(cell.cellId)}
                        className="hover:text-foreground"
                        type="button"
                        aria-label="Copy cell ID"
                        title="Copy cell ID"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <span>· entered {formatRelative(cell.lastEnteredAt)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        className="h-7 gap-1 px-2 text-[0.65rem]"
                        onClick={() => void copyCellInvite(myCellInviteUrl(cell.cellId))}
                      >
                        <Link2 className="h-3 w-3" /> Copy invite link
                      </Button>
                      {canNativeShare() && (
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          className="h-7 gap-1 px-2 text-[0.65rem]"
                          onClick={() => void shareCellInvite(myCellInviteUrl(cell.cellId), cell.name)}
                        >
                          <Share2 className="h-3 w-3" /> Share
                        </Button>
                      )}
                      {myUserId && cell.ownerUserId === myUserId && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/40 px-2 py-1 text-[0.65rem]">
                              {cell.isPublic ? <Globe className="h-3 w-3 text-emerald-500" /> : <Lock className="h-3 w-3 text-muted-foreground" />}
                              Public
                              <Switch
                                checked={!!cell.isPublic}
                                onCheckedChange={(next) => handlePublic(cell, next)}
                                aria-label={`Make ${cell.name} public`}
                                className="scale-75"
                              />
                            </label>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            {cell.isPublic
                              ? 'Public: listed in Explore for anyone to join, and live posts made in the cell also broadcast to the main mesh. Older or offline backlog stays in the cell.'
                              : 'Private: invite-only and not listed. Nothing in this cell broadcasts to the main mesh.'}
                          </TooltipContent>
                        </Tooltip>
                      )}
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

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setNameTouched(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User Cell</DialogTitle>
            <DialogDescription>
              A private mesh you own. Share its invite link with peers to bring them in.
            </DialogDescription>
          </DialogHeader>
          <form
            id="create-cell-form"
            className="space-y-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <Label htmlFor="cell-name">
              Cell name <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input
              id="cell-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setNameTouched(true)}
              placeholder="e.g. Studio Friends"
              maxLength={CELL_NAME_MAX}
              required
              aria-required="true"
              aria-invalid={nameTouched && nameMissing}
              aria-describedby="cell-name-hint"
              autoFocus
            />
            <p
              id="cell-name-hint"
              className={nameTouched && nameMissing ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
            >
              {nameTouched && nameMissing ? 'Give your cell a name.' : 'Required. Peers see this name when you invite them.'}
            </p>
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} type="button">
              Cancel
            </Button>
            <Button form="create-cell-form" type="submit" disabled={busy || nameMissing}>
              Create Cell
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
