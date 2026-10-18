/** Move SWARM between the native wallet and the linked MetaMask key's ledger slot. */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { toast } from "sonner";
import { useMetaMask } from "@/hooks/useMetaMask";
import { getCachedPrivateKey, getCurrentUser, loginUser } from "@/lib/auth";
import { getLinkedWallet, linkMetaMaskWallet } from "@/lib/blockchain/wallets/walletLink";
import { depositSwarmFromMetaMask, getMetaMaskSwarmBalance, withdrawSwarmToMetaMask } from "@/lib/blockchain/wallets/swarmMetaMask";
import { MetaMaskConnectButton } from "./MetaMaskConnectButton";

export function SwarmMetaMaskDialog({ mode, userId, nativeBalance }: { mode: "withdraw" | "deposit"; userId: string; nativeBalance: number }) {
  const { address } = useMetaMask();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState<string | null>(null);
  const [mmBalance, setMmBalance] = useState(0);

  useEffect(() => {
    if (!open || !userId) return;
    setLinked(getLinkedWallet(userId)?.address ?? null);
    void getMetaMaskSwarmBalance(address).then(setMmBalance);
  }, [open, userId, address]);

  const available = mode === "withdraw" ? nativeBalance : mmBalance;
  const sameAccount = !!address && linked === address.toLowerCase();
  const parsed = Number(amount);
  const invalid = !Number.isFinite(parsed) || parsed <= 0 || parsed > available;

  const link = async () => {
    setBusy(true);
    try { setLinked((await linkMetaMaskWallet(userId)).address); toast.success("MetaMask linked to your SWARM wallet"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Linking failed"); }
    finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try {
      if (mode === "withdraw") {
        // Moving native funds needs the native account unlocked, not just MetaMask.
        if (!await getCachedPrivateKey()) {
          if (!pass) throw new Error("Enter your account passphrase");
          await loginUser(pass);
        }
        if (getCurrentUser()?.id !== userId) throw new Error("Unlock the account belonging to this wallet");
        setPass("");
        await withdrawSwarmToMetaMask(userId, parsed);
        toast.success(`${parsed} SWARM sent to your MetaMask wallet`);
      } else {
        await depositSwarmFromMetaMask(userId, parsed);
        toast.success(`${parsed} SWARM deposited to your native wallet`);
      }
      setOpen(false); setAmount("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Move failed"); }
    finally { setBusy(false); }
  };

  const title = mode === "withdraw" ? "Send SWARM to MetaMask" : "Deposit SWARM from MetaMask";
  return <>
    <Button type="button" variant="outline" size="sm" disabled={!userId} onClick={() => setOpen(true)}>
      {mode === "withdraw" ? <ArrowUpFromLine className="mr-1 h-3 w-3" /> : <ArrowDownToLine className="mr-1 h-3 w-3" />}
      {mode === "withdraw" ? "Transfer / Withdraw" : "Deposit to Native"}
    </Button>
    <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {!address ? <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">Connect MetaMask first.</p>
          <MetaMaskConnectButton compact />
        </div> : !sameAccount ? <div className="space-y-2 text-sm">
          <p>Step 1: link <span className="break-all font-mono text-xs">{address}</span> to your SWARM wallet. MetaMask asks you to sign a message — nothing moves.</p>
          {linked && <p className="text-xs text-destructive">A different MetaMask account is linked ({linked}). Linking this one replaces it.</p>}
          <DialogFooter><Button type="button" disabled={busy} onClick={() => void link()}>{busy ? "Waiting for MetaMask…" : "Link wallet"}</Button></DialogFooter>
        </div> : <div className="space-y-3">
          <p className="text-sm">Native: <span className="font-semibold tabular-nums">{nativeBalance.toLocaleString(undefined, { maximumFractionDigits: 8 })} SWARM</span></p>
          <p className="text-sm">MetaMask wallet: <span className="font-semibold tabular-nums">{mmBalance.toLocaleString(undefined, { maximumFractionDigits: 8 })} SWARM</span></p>
          <div className="space-y-2">
            <Label htmlFor="swarm-mm-amount">Amount (SWARM)</Label>
            <Input id="swarm-mm-amount" type="number" inputMode="decimal" min="0" step="any" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setAmount(String(available))}>Max</Button>
          </div>
          {mode === "withdraw" && <div className="space-y-2">
            <Label htmlFor="swarm-mm-pass">Account passphrase</Label>
            <Input id="swarm-mm-pass" type="password" autoComplete="current-password" value={pass} disabled={busy} onChange={(e) => setPass(e.target.value)} />
          </div>}
          <p className="text-xs text-muted-foreground">Works like a cold wallet: the SWARM sits on the SWARM network under your MetaMask address, and only your MetaMask can sign it back. MetaMask confirms with a signature — no network switch or fee.</p>
          <DialogFooter><Button type="button" disabled={busy || invalid} onClick={() => void run()}>{busy ? "Confirm in MetaMask…" : mode === "withdraw" ? "Send to MetaMask" : "Deposit"}</Button></DialogFooter>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
