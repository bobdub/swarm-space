/** MetaMask -> native SWARM wallet MintMe deposit. MetaMask is the only witness; the chain keeps the signed record. */
import { useEffect, useState } from "react";
import { useWalletDialogTask } from "@/hooks/useWalletDialogTask";
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
import { depositEth, readEthBalance } from "@/lib/blockchain/deposits/ethDeposit";

const ASSETS = {
  MINTME: { name: "MintMe", network: "MintMe", read: readMintMeBalance, deposit: depositMintMe },
  ETH: { name: "ETH", network: "Ethereum", read: readEthBalance, deposit: depositEth },
} as const;
import { MetaMaskConnectButton } from "./MetaMaskConnectButton";

export function MintMeDepositDialog({ userId, label = "Deposit", asset = "MINTME" }: { userId: string; label?: string; asset?: keyof typeof ASSETS }) {
  const cfg = ASSETS[asset];
  const { address } = useMetaMask();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const { busy, run: walletTask } = useWalletDialogTask(open);
  const [held, setHeld] = useState<number | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    setLinked(getLinkedWallet(userId)?.address ?? null);
    if (address) void cfg.read(address).then(setHeld).catch(() => setHeld(null));
  }, [open, userId, address, cfg]);

  const sameAccount = !!address && linked === address.toLowerCase();
  const parsed = Number(amount);
  const invalid = !Number.isFinite(parsed) || parsed <= 0 || (held != null && parsed > held);

  const link = () => walletTask((signal) => linkMetaMaskWallet(userId, signal), (link) => {
    setLinked(link.address); toast.success("MetaMask linked to your SWARM wallet");
  });
  const deposit = () => walletTask(async () => {
      const tx = await cfg.deposit({ swarmId: userId, amount: parsed });
      toast.success(`${parsed} ${asset} recorded on your SWARM wallet`, { description: String((tx.meta as Record<string, unknown>)?.txHash ?? "") });
    }, () => { setOpen(false); setAmount(""); });

  return <>
    <Button type="button" variant="outline" size="sm" disabled={!userId} onClick={() => setOpen(true)}>
      <ArrowDownToLine className="mr-1 h-3 w-3" />{label}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Deposit {cfg.name} from MetaMask</DialogTitle></DialogHeader>
        {!address ? <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">Connect MetaMask to deposit {cfg.name}.</p>
          <MetaMaskConnectButton compact />
        </div> : !sameAccount ? <div className="space-y-2 text-sm">
          <p>Step 1: link <span className="break-all font-mono text-xs">{address}</span> to your SWARM wallet. MetaMask will ask you to sign a message — no coins move.</p>
          {linked && <p className="text-xs text-destructive">A different MetaMask account is linked ({linked}). Linking this one replaces it.</p>}
          <DialogFooter><Button type="button" disabled={busy} onClick={() => void link()}>{busy ? "Waiting for MetaMask…" : "Link wallet"}</Button></DialogFooter>
        </div> : <div className="space-y-3">
          <p className="text-sm">In MetaMask: <span className="font-semibold tabular-nums">{held == null ? "checking…" : `${held.toFixed(6)} ${asset}`}</span></p>
          <div className="space-y-2">
            <Label htmlFor="mintme-deposit-amount">Amount ({asset})</Label>
            <Input id="mintme-deposit-amount" type="number" inputMode="decimal" min="0" step="any" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </div>
          <p className="text-xs text-muted-foreground">MetaMask switches to the {cfg.network} network, confirms a transfer to your own linked address, then signs the deposit record. Your coins stay in your MetaMask; the SWARM chain records the signed holding. MetaMask is the only witness until a {cfg.network} node can re-check it.</p>
          <DialogFooter><Button type="button" disabled={busy || invalid} onClick={() => void deposit()}>{busy ? "Confirm in MetaMask…" : "Deposit"}</Button></DialogFooter>
        </div>}
        {busy && <p role="status" className="text-xs text-muted-foreground">Waiting for MetaMask. You can close this window; closing does not cancel a transfer already submitted to MetaMask.</p>}
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      </DialogContent>
    </Dialog>
  </>;
}
