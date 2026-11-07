/** Native transfers use the signed identity ledger. External exports require a real bridge. */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowDownToLine, ArrowUpFromLine, Copy } from "lucide-react";
import { toast } from "sonner";
import { getCachedPrivateKey, getCurrentUser } from "@/lib/auth";
import { useNativeWalletAddress } from "@/hooks/useNativeWalletAddress";
import { sendWalletTip } from "@/lib/blockchain/wallets/walletTips";

export function SwarmBridgeDialog({ mode, balance, userId, className }: {
  mode: "deposit" | "withdraw"; balance: number; userId: string; className?: string; initialLayer?: "native";
}) {
  const nativeAddress = useNativeWalletAddress(userId);
  const [open, setOpen] = useState(false);
  const [layer] = useState<"native">("native");
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = Number(amount);
  const invalid = !userId || !dest.trim() || !Number.isFinite(parsed) || parsed <= 0 || parsed > balance;
  const changeOpen = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (next) { setAmount(""); setDest(""); }
  };
  const submit = async () => {
    if (invalid || busy || layer !== "native" || mode !== "withdraw") return;
    setBusy(true);
    try {
      if (!await getCachedPrivateKey()) throw new Error("Your signing vault is locked. Sign in again to unlock it; no transfer was sent.");
      if (getCurrentUser()?.id !== userId) throw new Error("Sign in with the account belonging to this wallet");
      await sendWalletTip({ recipient: dest.trim(), assetId: "chain:SWARM", amount: parsed, intent: "transfer" });
      toast.success("Transfer recorded; peer sync queued", { description: `${parsed} SWARM to ${dest.trim()}` });
      setOpen(false);
      setAmount("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Transfer failed");
    } finally { setBusy(false); }
  };
  return <>
    <Button type="button" variant="outline" size="sm" className={className} disabled={!userId} onClick={() => changeOpen(true)}>
      {mode === "deposit" ? <ArrowDownToLine className="mr-1 h-3 w-3" /> : <ArrowUpFromLine className="mr-1 h-3 w-3" />}
      {mode === "deposit" ? "Receive" : "Transfer / Withdraw"}
    </Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{mode === "deposit" ? "Receive SWARM" : "Transfer / Withdraw SWARM"}</DialogTitle></DialogHeader>
        {mode === "deposit" ? <div className="space-y-2">
          <Label>Native SWARM wallet address</Label>
          <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 break-all font-mono text-xs">{nativeAddress || "Loading address…"}</span><Button type="button" variant="ghost" size="icon" className="shrink-0" disabled={!nativeAddress} aria-label="Copy receiving address" title="Copy receiving address" onClick={() => void navigator.clipboard.writeText(nativeAddress).then(() => toast.success("Wallet address copied")).catch(() => toast.error("Copy failed"))}><Copy className="h-4 w-4" /></Button></div>
          <p className="text-xs text-muted-foreground">SWARM network only. External deposits are not available.</p>
        </div> : <>
          <p className="text-sm">Available: <span className="font-semibold tabular-nums">{balance.toLocaleString(undefined, { maximumFractionDigits: 8 })} SWARM</span></p>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="native-transfer-recipient">Recipient SWARM address</Label><Input id="native-transfer-recipient" value={dest} onChange={e => setDest(e.target.value)} placeholder="0x…" disabled={busy} /></div>
            <div className="space-y-2"><Label htmlFor="native-transfer-amount">Amount (SWARM)</Label><Input id="native-transfer-amount" type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" disabled={busy} /><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setAmount(String(balance))}>Max</Button></div>
            <p className="text-xs text-muted-foreground">You're signed in as this wallet's owner, so the transfer is signed with your unlocked key — no passphrase needed.</p>
          </div>
          <DialogFooter><Button type="button" disabled={invalid || busy} onClick={() => void submit()}>{busy ? "Signing…" : "Send SWARM"}</Button></DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
export default SwarmBridgeDialog;
