/**
 * CellChainPanel — what Wallet > Chain shows for a cell's own blockchain:
 * the member's balance in the cell coin, the chain's height and supply, its
 * members, and the actions they can take (send, invite, remove, leave).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Users } from "lucide-react";
import {
  cellWalletView,
  inviteToCell,
  leaveCell,
  removeFromCell,
  sendCellCoin,
  type CellActionResult,
  type CellWalletView,
} from "@/lib/blockchain/cellChain/cellWallet";
import { getCellSession } from "@/lib/blockchain/cellChain/cellRuntime";

interface Props {
  cellId: string;
  userId: string;
  onBack: () => void;
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function formatAmount(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function CellChainPanel({ cellId, userId, onBack }: Props) {
  const [view, setView] = useState<CellWalletView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [inviteId, setInviteId] = useState("");

  // Each load belongs to one cell and account; a late answer for another is dropped.
  const current = useRef("");
  current.current = `${cellId}:${userId}`;
  const load = useCallback(async () => {
    const key = `${cellId}:${userId}`;
    const next = await cellWalletView(cellId, userId, getCellSession()).catch(() => null);
    if (current.current === key) setView(next);
  }, [cellId, userId]);

  useEffect(() => {
    setView(undefined);
    setSendTo("");
    setSendAmount("");
    setInviteId("");
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [load]);

  const run = async (action: () => Promise<CellActionResult>, done: string) => {
    setBusy(true);
    try {
      const result = await action();
      if (result.ok) toast.success(done);
      else toast.error(result.reason ?? "That didn't work.");
      await load();
      return result.ok;
    } finally {
      setBusy(false);
    }
  };

  if (view === undefined) return null;
  if (view === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cell chain not available</CardTitle>
          <CardDescription>
            This device doesn't have that cell's chain, or you're no longer one of its members.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={onBack}>Back to SWARM</Button>
        </CardContent>
      </Card>
    );
  }

  const others = view.members.filter((m) => m !== userId);
  const invitable = view.connected.filter((a) => a !== userId && !view.members.includes(a) && !view.invited.includes(a));
  const label = (id: string) => (id === userId ? "You" : shortId(id));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              {view.name}
            </CardTitle>
            <Badge variant="outline">{view.ticker}</Badge>
          </div>
          <CardDescription>
            This cell's own blockchain. Its members mine it under the same rules as SWARM, and its coin stays inside the cell.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Your balance</p>
            <p className="text-xl font-semibold">{formatAmount(view.balance)} {view.ticker}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Maturing</p>
            <p className="text-xl font-semibold">{formatAmount(view.maturing)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Block height</p>
            <p className="text-xl font-semibold">{view.height}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Mined so far</p>
            <p className="text-xl font-semibold">{formatAmount(view.supply)}</p>
          </div>
          <p className="col-span-2 sm:col-span-4 text-xs text-muted-foreground">
            {view.active
              ? `You're in this cell now${view.connected.length ? `, with ${view.connected.length} connected` : ""}. Mining runs while blockchain sync and mining are on.`
              : "Enter the cell to mine it and sync with its members."}
            {view.pending > 0 ? ` ${view.pending} waiting for the next block.` : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members ({view.members.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {view.members.map((m) => (
            <div key={m} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <span className="font-mono text-sm truncate" title={m}>{label(m)}</span>
              <span className="flex items-center gap-2 shrink-0">
                {m === view.owner && <Badge variant="secondary">Creator</Badge>}
                {view.connected.includes(m) && m !== userId && <Badge variant="outline">Connected</Badge>}
                {view.isOwner && m !== userId && (
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => void run(() => removeFromCell(cellId, m), "Removal queued for the next block")}>
                    Remove
                  </Button>
                )}
              </span>
            </div>
          ))}
          {view.invited.map((m) => (
            <div key={m} className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2">
              <span className="font-mono text-sm truncate" title={m}>{shortId(m)}</span>
              <Badge variant="outline">Invited</Badge>
            </div>
          ))}
          {!view.isOwner && (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => void run(() => leaveCell(cellId), "Leaving: it takes effect in the next block")}>
              Leave cell
            </Button>
          )}
        </CardContent>
      </Card>

      {view.isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite</CardTitle>
            <CardDescription>
              An invite rides in the next block. A connected invitee joins on its own; anyone else joins the next time they're in the cell.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {invitable.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {invitable.map((a) => (
                  <Button key={a} size="sm" variant="secondary" disabled={busy}
                    onClick={() => void run(() => inviteToCell(cellId, a), "Invite sent")}>
                    Invite {shortId(a)}
                  </Button>
                ))}
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => inviteToCell(cellId, inviteId), "Invite sent").then((ok) => { if (ok) setInviteId(""); });
              }}
            >
              <Input value={inviteId} onChange={(e) => setInviteId(e.target.value)} placeholder="Account ID" aria-label="Account ID to invite" />
              <Button type="submit" disabled={busy || !inviteId.trim()}>Invite</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {others.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send {view.ticker}</CardTitle>
            <CardDescription>Only to other members of this cell. Mined coins can be spent once 20 blocks sit on top of them.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => sendCellCoin(cellId, sendTo, Number(sendAmount)), "Transfer queued for the next block")
                  .then((ok) => { if (ok) setSendAmount(""); });
              }}
            >
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
                aria-label="Member to send to"
              >
                <option value="">Pick a member</option>
                {others.map((m) => <option key={m} value={m}>{shortId(m)}</option>)}
              </select>
              <Input type="number" min="0" step="any" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)}
                placeholder="Amount" aria-label="Amount to send" />
              <Button type="submit" disabled={busy || !sendTo || !(Number(sendAmount) > 0)}>Send</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
