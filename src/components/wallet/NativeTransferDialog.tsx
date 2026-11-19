/**
 * NativeTransferDialog — send a native asset by @username, to an online
 * connected peer, or directly to a SWARM wallet address.
 *
 * The recipient field searches known members (swarm library + synced users)
 * by @username or display name. Picking one — or typing an exact handle —
 * resolves to the wallet id under the hood and shows who will be paid
 * before continuing. Raw swarm: ids, user ids and 0x receiving aliases still
 * resolve through the shared resolver as a fallback. Every path opens the
 * same Send & Tip modal; the transfer records locally and syncs to the
 * recipient once a peer connection exists.
 */
import { useEffect, useState } from "react";
import { ArrowUpFromLine, Radio, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useP2PContext } from "@/contexts/P2PContext";
import { SendCreditsModal } from "@/components/SendCreditsModal";
import { nativeWalletAddress, resolveNativeWalletRecipient } from "@/lib/blockchain/wallets/nativeAddress";
import {
  looksLikeWalletAddress, normalizeRecipientQuery, resolveWalletRecipientInput, searchWalletRecipients,
  type WalletRecipientCandidate,
} from "@/lib/blockchain/wallets/recipientSearch";
import type { User } from "@/types";

interface OnlineRecipient {
  userId: string;
  name: string;
  username?: string;
}

interface ConfirmRecipient extends OnlineRecipient {
  address: string;
}

const fromUser = (user: User): OnlineRecipient => ({
  userId: user.id,
  name: user.displayName || user.username || `user ${user.id.slice(0, 8)}`,
  username: user.username || undefined,
});

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
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<WalletRecipientCandidate[]>([]);
  const [confirm, setConfirm] = useState<ConfirmRecipient | null>(null);
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
          username: conn.profile?.username,
        });
      }
      setRecipients(list);
    };
    refresh();
    return subscribeToStats(refresh);
  }, [open, userId, getActivePeerConnections, subscribeToStats]);

  useEffect(() => {
    if (!open || confirm || !normalizeRecipientQuery(query) || looksLikeWalletAddress(query)) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchWalletRecipients(query, userId)
        .then(list => { if (!cancelled) setSuggestions(list); })
        .catch(() => { if (!cancelled) setSuggestions([]); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query, userId, confirm]);

  const reset = () => { setQuery(""); setSuggestions([]); setConfirm(null); };

  const review = async (pick: OnlineRecipient) => {
    if (pick.userId === userId) {
      toast.error("That address belongs to your own wallet.");
      return;
    }
    setConfirm({ ...pick, address: await nativeWalletAddress(pick.userId) });
    setSuggestions([]);
  };

  /** Pick from the list or resolve typed text, then show who will be paid. */
  const resolveAndReview = async (pick?: WalletRecipientCandidate) => {
    if (resolving || (!pick && !query.trim())) return;
    setResolving(true);
    try {
      const user = pick ? await resolveNativeWalletRecipient(pick.userId) : await resolveWalletRecipientInput(query, userId);
      await review({ ...fromUser(user), ...(pick ? { name: pick.displayName, username: pick.username } : {}) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "SWARM wallet recipient not found. Sync with this user first.");
    } finally {
      setResolving(false);
    }
  };

  const proceed = () => {
    if (!confirm) return;
    setOpen(false);
    reset();
    setTarget({ userId: confirm.userId, name: confirm.name, username: confirm.username });
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={!userId || amount <= 0}
        title={amount <= 0 ? `You hold no ${assetLabel} to transfer.` : `Send ${assetLabel} by username, to a connected peer, or to a SWARM address`}
        onClick={() => setOpen(true)}>
        <ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer
      </Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Transfer {assetLabel}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Only send to SWARM wallets. Offline members sync when you next connect.
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
                      onClick={() => void review(r)}>
                      <Radio className="h-3.5 w-3.5 text-primary" aria-label="Online" />
                      <span className="truncate">{r.name}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2 border-t pt-3">
            <Label htmlFor="native-transfer-recipient">Send to a username or address</Label>
            {confirm ? (
              <div role="group" aria-label="Confirm recipient" className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate font-medium">{confirm.name}</span>
                  {confirm.username && confirm.username !== confirm.name && (
                    <span className="truncate text-sm text-muted-foreground">@{confirm.username}</span>
                  )}
                </div>
                <p className="break-all font-mono text-[10px] text-muted-foreground">{confirm.address}</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="flex-1" onClick={reset}>Change</Button>
                  <Button type="button" size="sm" className="flex-1" onClick={proceed}>
                    Continue to {confirm.username ? `@${confirm.username}` : confirm.name}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Input id="native-transfer-recipient" value={query} disabled={resolving} autoComplete="off"
                    role="combobox" aria-expanded={suggestions.length > 0} aria-controls="native-transfer-suggestions"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolveAndReview(); } }}
                    placeholder="@username, 0x… or swarm:user-id" className="text-sm" />
                  <Button type="button" size="sm" disabled={resolving || !query.trim()} onClick={() => void resolveAndReview()}>
                    {resolving ? "Checking…" : "Find"}
                  </Button>
                </div>
                {suggestions.length > 0 && (
                  <ul id="native-transfer-suggestions" role="listbox" aria-label="Matching members" className="space-y-1 rounded-md border p-1">
                    {suggestions.map((c) => (
                      <li key={c.userId} role="option" aria-selected={false}>
                        <Button type="button" variant="ghost" className="w-full justify-start gap-2" disabled={resolving}
                          onClick={() => void resolveAndReview(c)}>
                          <span className="truncate">{c.displayName}</span>
                          {c.username !== c.displayName && <span className="truncate text-xs text-muted-foreground">@{c.username}</span>}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Search members you have synced with by @username, or paste a SWARM wallet address. The transfer records now and reaches offline recipients when you connect.
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {target && (
        <SendCreditsModal toUserId={target.userId} toUsername={target.username || target.name} toDisplayName={target.name} isOpen
          initialAssetId={assetId} onClose={() => setTarget(null)} />
      )}
    </>
  );
}
