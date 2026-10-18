/** Native transfers use the signed identity ledger. External exports require a real bridge. */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowDownToLine, ArrowUpFromLine, Copy, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useMetaMask } from "@/hooks/useMetaMask";
import { getCachedPrivateKey, getCurrentUser, loginUser } from "@/lib/auth";
import { nativeWalletAddress } from "@/lib/blockchain/wallets/nativeAddress";
import { sendWalletTip } from "@/lib/blockchain/wallets/walletTips";
import { MetaMaskConnectButton } from "./MetaMaskConnectButton";

export function SwarmBridgeDialog({ mode, balance, userId, className }: {
  mode: "deposit" | "withdraw"; balance: number; userId: string; className?: string;
}) {
  const { address } = useMetaMask();
  const [open, setOpen] = useState(false);
  const [layer, setLayer] = useState<"native" | "export">("native");
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = Number(amount);
  const invalid = !userId || !dest.trim().startsWith("swarm:") || !Number.isFinite(parsed) || parsed <= 0 || parsed > balance;
  const changeOpen = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    setPassphrase("");
    if (next) { setLayer("native"); setAmount(""); setDest(""); }
  };
  const submit = async () => {
    if (invalid || busy || layer !== "native" || mode !== "withdraw") return;
    setBusy(true);
    try {
      if (!await getCachedPrivateKey()) {
        if (!passphrase) throw new Error("Enter your account passphrase to sign this transfer");
        await loginUser(passphrase);
      }
      if (getCurrentUser()?.id !== userId) throw new Error("Unlock the account belonging to this wallet");
      setPassphrase("");
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
          <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 break-all font-mono text-xs">{nativeWalletAddress(userId)}</span><Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Copy receiving address" title="Copy receiving address" onClick={() => void navigator.clipboard.writeText(nativeWalletAddress(userId)).then(() => toast.success("Wallet address copied")).catch(() => toast.error("Copy failed"))}><Copy className="h-4 w-4" /></Button></div>
          <p className="text-xs text-muted-foreground">SWARM network only. External deposits are not available.</p>
        </div> : <>
          <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
            <Button type="button" size="sm" variant={layer === "native" ? "default" : "ghost"} disabled={busy} onClick={() => setLayer("native")}>On-network</Button>
            <Button type="button" size="sm" variant={layer === "export" ? "default" : "ghost"} disabled={busy} onClick={() => { setLayer("export"); setPassphrase(""); }}>MetaMask export</Button>
          </div>
          <p className="text-sm">Available: <span className="font-semibold tabular-nums">{balance.toLocaleString(undefined, { maximumFractionDigits: 8 })} SWARM</span></p>
          {layer === "native" ? <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="native-transfer-recipient">Recipient SWARM address</Label><Input id="native-transfer-recipient" value={dest} onChange={e => setDest(e.target.value)} placeholder="swarm:…" disabled={busy} /></div>
            <div className="space-y-2"><Label htmlFor="native-transfer-amount">Amount (SWARM)</Label><Input id="native-transfer-amount" type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" disabled={busy} /><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setAmount(String(balance))}>Max</Button></div>
            <div className="space-y-2"><Label htmlFor="native-transfer-passphrase">Account passphrase</Label><Input id="native-transfer-passphrase" type="password" autoComplete="current-password" value={passphrase} onChange={e => setPassphrase(e.target.value)} disabled={busy} /></div>
          </div> : <div className="space-y-3">
            {address ? <div className="space-y-1"><Label>Synced MetaMask wallet</Label><p className="break-all font-mono text-xs">{address}</p></div> : <MetaMaskConnectButton compact />}
            <Alert><ShieldAlert className="h-4 w-4" /><AlertDescription>MetaMask export is unavailable until a verified transfer bridge is connected. No SWARM will be deducted.</AlertDescription></Alert>
          </div>}
          <DialogFooter><Button type="button" disabled={layer !== "native" || invalid || busy} onClick={() => void submit()}>{busy ? "Signing…" : layer === "native" ? "Send SWARM" : "Export unavailable"}</Button></DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
export default SwarmBridgeDialog;
