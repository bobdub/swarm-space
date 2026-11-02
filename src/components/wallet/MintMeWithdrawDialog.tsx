import { useState } from "react";
import { ArrowUpFromLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Direct native → MintMe withdrawal signed by the user's own on-device key; no MetaMask. */
export function MintMeWithdrawDialog({ userId, amount }: { userId: string; amount: number }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const send = () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) { toast.error("Enter an amount"); return; }
    setBusy(true);
    void import("@/lib/blockchain/wallets/nativeMintmeDirect")
      .then(m => m.withdrawNativeMintMe({ userId, to: to.trim(), amount: n }))
      .then(hash => { toast.success(`Sent on MintMe: ${hash.slice(0, 12)}…`); setOpen(false); setTo(""); setValue(""); })
      .catch(e => toast.error(e instanceof Error ? e.message : "Withdrawal failed"))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={!userId || amount <= 0} onClick={() => setOpen(true)}>
        <ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer / Withdraw
      </Button>
      <Dialog open={open} onOpenChange={o => !busy && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Withdraw MINTME to MintMe</DialogTitle></DialogHeader>
          <div role="form" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Sends from your native wallet to any MintMe address. A tiny MintMe network fee is paid in MINTME. No MetaMask needed.
            </p>
            <div className="space-y-1">
              <Label htmlFor="mintme-withdraw-to">MintMe address</Label>
              <Input id="mintme-withdraw-to" placeholder="0x…" value={to} onChange={e => setTo(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mintme-withdraw-amount">Amount (available {amount.toFixed(4)})</Label>
              <Input id="mintme-withdraw-amount" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} disabled={busy} />
            </div>
            <Button type="button" className="w-full" disabled={busy || !to || !value} onClick={send}>
              {busy ? "Sending on MintMe…" : "Withdraw"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
