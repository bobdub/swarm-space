/** MetaMask -> native SWARM wallet MintMe deposit. MetaMask is the only witness; the chain keeps the signed record. */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { useMetaMask } from "@/hooks/useMetaMask";
import { getLinkedWallet, linkMetaMaskWallet } from "@/lib/blockchain/wallets/walletLink";
import { readMintMeBalance } from "@/lib/blockchain/wallets/mintmeBridge";
import { depositMintMe } from "@/lib/blockchain/deposits/mintmeDeposit";
import { MetaMaskConnectButton } from "./MetaMaskConnectButton";

export function MintMeDepositDialog({ userId, label = "Deposit" }: { userId: string; label?: string }) {
  const { address } = useMetaMask();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<number | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    setLinked(getLinkedWallet(userId)?.address ?? null);
    if (address) void readMintMeBalance(address).then(setHeld).catch(() => setHeld(null));
  }, [open, userId, address]);

  const sameAccount = !!address && linked === address.toLowerCase();
  const parsed = Number(amount);
  const invalid = !Number.isFinite(parsed) || parsed <= 0 || (held != null && parsed > held);

  const link = async () => {
    setBusy(true);
    try { setLinked((await linkMetaMaskWallet(userId)).address); toast.success("MetaMask linked to your SWARM wallet"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Linking failed"); }
    finally { setBusy(false); }
  };
  const deposit = async () => {
    setBusy(true);
    try {
      const tx = await depositMintMe({ swarmId: userId, amount: parsed });
      toast.success(`${parsed} MINTME recorded on your SWARM wallet`, { description: String((tx.meta as Record<string, unknown>)?.txHash ?? "") });
      setOpen(false); setAmount("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Deposit failed"); }
    finally { setBusy(false); }
  };

  return <>
    <Button type="button" variant="outline" size="sm" disabled={!userId} onClick={() => setOpen(true)}>
      <ArrowDownToLine className="mr-1 h-3 w-3" />{label}
    </Button>
    <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Deposit MintMe from MetaMask</DialogTitle></DialogHeader>
        {!address ? <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">Connect MetaMask to deposit MintMe.</p>
          <MetaMaskConnectButton compact />
        </div> : !sameAccount ? <div className="space-y-2 text-sm">
          <p>Step 1: link <span className="break-all font-mono text-xs">{address}</span> to your SWARM wallet. MetaMask will ask you to sign a message — no coins move.</p>
          {linked && <p className="text-xs text-destructive">A different MetaMask account is linked ({linked}). Linking this one replaces it.</p>}
          <DialogFooter><Button type="button" disabled={busy} onClick={() => void link()}>{busy ? "Waiting for MetaMask…" : "Link wallet"}</Button></DialogFooter>
        </div> : <div className="space-y-3">
          <p className="text-sm">In MetaMask: <span className="font-semibold tabular-nums">{held == null ? "checking…" : `${held.toFixed(6)} MINTME`}</span></p>
          <div className="space-y-2">
            <Label htmlFor="mintme-deposit-amount">Amount (MINTME)</Label>
            <Input id="mintme-deposit-amount" type="number" inputMode="decimal" min="0" step="any" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </div>
          <p className="text-xs text-muted-foreground">MetaMask switches to the MintMe network, confirms a transfer to your own linked address, then signs the deposit record. Your coins stay in your MetaMask; the SWARM chain records the signed holding. MetaMask is the only witness until a MintMe node can re-check it.</p>
          <DialogFooter><Button type="button" disabled={busy || invalid} onClick={() => void deposit()}>{busy ? "Confirm in MetaMask…" : "Deposit"}</Button></DialogFooter>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
