/**
 * NativeTransferDialog — send a native asset to an online connected peer or
 * directly to a SWARM wallet address.
 *
 * Peer picks open the Send & Tip modal preselected to the asset. Address
 * sends resolve swarm: ids, raw user ids and 0x receiving aliases through
 * the shared resolver, then open the same modal for the resolved user —
 * the transfer records locally and syncs to the recipient once a peer
 * connection exists.
 */
import { useEffect, useState } from "react";
import { ArrowUpFromLine, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useP2PContext } from "@/contexts/P2PContext";
import { SendCreditsModal } from "@/components/SendCreditsModal";
import { resolveNativeWalletRecipient } from "@/lib/blockchain/wallets/nativeAddress";

interface OnlineRecipient {
  userId: string;
  name: string;
}

export function NativeTransferDialog({ userId, assetId, assetLabel, amount }: {
  userId: string;
  assetId: string;
  assetLabel: string;
  amount: number;
}) {
  const { getActivePeerConnections, subscribeToStats } = useP2PContext();
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState<OnlineRecipient[]>([]);
  const [target, setTarget] = useState<OnlineRecipient | null>(null);
  const [address, setAddress] = useState("");
  const [resolving, setResolving] = useState(false);

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

  const sendToAddress = async () => {
    const input = address.trim();
    if (!input || resolving) return;
    setResolving(true);
    try {
      const user = await resolveNativeWalletRecipient(input);
      if (user.id === userId) {
        toast.error("That address belongs to your own wallet.");
        return;
      }
      setOpen(false);
      setAddress("");
      setTarget({ userId: user.id, name: user.displayName || user.username || `user ${user.id.slice(0, 8)}` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "SWARM wallet recipient not found. Sync with this user first.");
    } finally {
      setResolving(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={!userId || amount <= 0}
        title={amount <= 0 ? `You hold no ${assetLabel} to transfer.` : `Send ${assetLabel} to a connected peer or SWARM address`}
        onClick={() => setOpen(true)}>
        <ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Transfer {assetLabel}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Only send to SWARM wallets — offline peers sync when connected and require an address.
          </p>
          <div className="space-y-1">
            <Label>Online connections</Label>
            {recipients.length === 0 ? (
              <div role="status" className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
                No connected peers are online. Peer picks unlock as soon as a peer connects — an address works anytime.
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
          </div>
          <div className="space-y-2 border-t pt-3">
            <Label htmlFor="native-transfer-address">SWARM wallet address</Label>
            <div className="flex items-center gap-2">
              <Input id="native-transfer-address" value={address} disabled={resolving}
                onChange={(e) => setAddress(e.target.value)} placeholder="0x… or swarm:user-id"
                className="font-mono text-xs" />
              <Button type="button" size="sm" disabled={resolving || !address.trim()} onClick={() => void sendToAddress()}>
                {resolving ? "Checking…" : "Send"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              The address must belong to a SWARM wallet you have synced with. The transfer records now and reaches offline recipients when you connect.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      {target && (
        <SendCreditsModal toUserId={target.userId} toUsername={target.name} isOpen
          initialAssetId={assetId} onClose={() => setTarget(null)} />
      )}
    </>
  );
}
