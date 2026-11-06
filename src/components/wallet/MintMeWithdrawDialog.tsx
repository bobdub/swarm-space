import { useCallback, useEffect, useState } from "react";
import { ArrowUpFromLine, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MINTME_NETWORK } from "@/lib/blockchain/wallets/mintmeNetwork";
import {
  canWithdraw, GAS_HOLD_MINTME, liveWithdrawDeps, maxWithdrawable, processWithdraw, readWithdrawals, saveWithdrawals, type WithdrawEntry, type WithdrawStatus,
} from "@/lib/blockchain/wallets/mintmeWithdrawQueue";

const LABEL: Record<WithdrawStatus, string> = { queued: "Queued", "waiting-peer": "Waiting for peer", sent: "Sent", reversed: "Reversed" };

/** Withdraw MINTME to any MintMe 0x address; peer-gated and queued, no MetaMask. */
export function MintMeWithdrawDialog({ userId, amount }: { userId: string; amount: number }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<WithdrawEntry[]>(() => readWithdrawals(userId));

  const runQueue = useCallback(async () => {
    const pending = readWithdrawals(userId).filter(e => e.status === "queued" || e.status === "waiting-peer");
    if (!pending.length) return;
    const deps = await liveWithdrawDeps(userId);
    for (const e of pending) {
      const next = await processWithdraw(e, deps, hash =>
        saveWithdrawals(userId, readWithdrawals(userId).map(x => x.id === e.id ? { ...x, txHash: hash } : x)));
      saveWithdrawals(userId, readWithdrawals(userId).map(x => x.id === e.id ? next : x));
      if (next.status === "sent") toast.success(`Sent on MintMe: ${next.txHash?.slice(0, 12)}…`);
    }
  }, [userId]);

  useEffect(() => {
    const sync = () => setList(readWithdrawals(userId));
    window.addEventListener("mintme-withdrawals", sync);
    const t = window.setInterval(() => void runQueue().catch(() => {}), 60_000);
    return () => { window.removeEventListener("mintme-withdrawals", sync); window.clearInterval(t); };
  }, [userId, runQueue]);

  const n = Number(value);
  const valid = canWithdraw(amount, n);
  const send = () => {
    const n = Number(value);
    if (!/^0x[a-fA-F0-9]{40}$/.test(to.trim())) { toast.error("Enter a valid MintMe address (0x…)."); return; }
    if (!canWithdraw(amount, n)) { toast.error(`Enter up to ${maxWithdrawable(amount)} MINTME (1 MINTME is held for gas).`); return; }
    const entry: WithdrawEntry = { id: crypto.randomUUID(), to: to.trim(), amount: n, status: "queued", createdAt: Date.now() };
    saveWithdrawals(userId, [...readWithdrawals(userId), entry]);
    setTo(""); setValue(""); setBusy(true);
    void runQueue().catch(() => {}).finally(() => setBusy(false));
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={!userId} onClick={() => setOpen(true)}>
        <ArrowUpFromLine className="mr-1 h-3 w-3" />Withdraw
      </Button>
      <Dialog open={open} onOpenChange={o => !busy && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Withdraw MINTME to MintMe
              <Link to="/cold-wallet-guide" aria-label="External withdrawal guide" className="text-muted-foreground hover:text-primary"><Info className="h-4 w-4" /></Link>
            </DialogTitle>
          </DialogHeader>
          <div role="form" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Send to any MintMe address. A connected peer checks the ledger first; without one your request waits. Mined rewards are released by the MintMe reward contract — on-chain release is coming soon, so those requests stay queued until then.
            </p>
            <div className="space-y-1">
              <Label htmlFor="mintme-withdraw-to">MintMe address</Label>
              <Input id="mintme-withdraw-to" placeholder="0x…" value={to} onChange={e => setTo(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="mintme-withdraw-amount">Amount (available {amount.toFixed(4)})</Label>
                <Button type="button" variant="link" size="sm" className="h-auto p-0" disabled={busy} onClick={() => setValue(String(maxWithdrawable(amount)))}>Max</Button>
              </div>
              <Input id="mintme-withdraw-amount" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} disabled={busy} />
            </div>
            <dl className="space-y-1 rounded-md border p-2 text-xs">
              <div className="flex justify-between"><dt className="text-muted-foreground">Withdraw</dt><dd>{Number.isFinite(n) && n > 0 ? n : 0} MINTME</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Gas fee (held)</dt><dd>{GAS_HOLD_MINTME} MINTME</dd></div>
              <div className="flex justify-between font-medium"><dt>Total needed</dt><dd>{(Number.isFinite(n) && n > 0 ? n : 0) + GAS_HOLD_MINTME} MINTME</dd></div>
              <p className="text-muted-foreground">Only the real network gas is taken; the rest of the hold stays in your balance.</p>
            </dl>
            <Button type="button" className="w-full" disabled={busy || !to || !valid} onClick={send}>
              {busy ? "Checking…" : "Withdraw"}
            </Button>
            {list.length > 0 && (
              <ul className="space-y-1 border-t pt-2 text-xs">
                {[...list].reverse().slice(0, 6).map(e => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="truncate">{e.amount} → {e.to.slice(0, 8)}…</span>
                    <span className="text-muted-foreground">
                      {e.status === "sent" && e.txHash
                        ? <a className="text-primary underline" href={`${MINTME_NETWORK.blockExplorerUrls[0].replace(/\/$/, "")}/tx/${e.txHash}`} target="_blank" rel="noreferrer">Sent</a>
                        : LABEL[e.status]}
                      {e.note && e.status !== "sent" ? ` · ${e.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
