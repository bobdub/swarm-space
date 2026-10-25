/**
 * OnlineTransferDialog — pick a transfer recipient from the peers that are
 * online and connected to this node right now.
 *
 * Native transfers settle through the mesh, so the recipient list is the
 * live connection set only: known-but-offline contacts are never offered.
 * Picking a peer opens the Send & Tip modal preselected to the asset.
 */
import { useEffect, useState } from "react";
import { ArrowUpFromLine, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useP2PContext } from "@/contexts/P2PContext";
import { SendCreditsModal } from "@/components/SendCreditsModal";

interface OnlineRecipient {
  userId: string;
  name: string;
}

export function OnlineTransferDialog({ userId, assetId, assetLabel, amount }: {
  userId: string;
  assetId: string;
  assetLabel: string;
  amount: number;
}) {
  const { getActivePeerConnections, subscribeToStats } = useP2PContext();
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState<OnlineRecipient[]>([]);
  const [target, setTarget] = useState<OnlineRecipient | null>(null);

  useEffect(() => {
    if (!open) return;
    const refresh = () => {
      const seen = new Set<string>();
      const list: OnlineRecipient[] = [];
      for (const conn of getActivePeerConnections()) {
        if (!conn.userId || conn.userId === userId || seen.has(conn.userId)) continue;
        seen.add(conn.userId);
        list.push({
          userId: conn.userId,
          name: conn.profile?.displayName || conn.profile?.username || `user ${conn.userId.slice(0, 8)}`,
        });
      }
      setRecipients(list);
    };
    refresh();
    return subscribeToStats(refresh);
  }, [open, userId, getActivePeerConnections, subscribeToStats]);

  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={!userId || amount <= 0}
        title={amount <= 0 ? `You hold no ${assetLabel} to transfer.` : `Send ${assetLabel} to a connected peer`}
        onClick={() => setOpen(true)}>
        <ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Transfer {assetLabel}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Transfers travel through the mesh, so you can only send to users who are online and connected to you right now.
          </p>
          {recipients.length === 0 ? (
            <div role="status" className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
              No connected peers are online. Transfers unlock as soon as a peer connects.
            </div>
          ) : (
            <ul className="space-y-1">
              {recipients.map((r) => (
                <li key={r.userId}>
                  <Button type="button" variant="ghost" className="w-full justify-start gap-2"
                    onClick={() => { setOpen(false); setTarget(r); }}>
                    <Radio className="h-3.5 w-3.5 text-primary" aria-label="Online" />
                    <span className="truncate">{r.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      {target && (
        <SendCreditsModal toUserId={target.userId} toUsername={target.name} isOpen
          initialAssetId={assetId} onClose={() => setTarget(null)} />
      )}
    </>
  );
}
