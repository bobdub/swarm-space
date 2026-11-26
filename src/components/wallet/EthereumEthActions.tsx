/**
 * ETH on the wallet's Ethereum view. ETH sent from any Ethereum wallet to the
 * member's receiving address (the same address as on MintMe) is credited to the
 * native SWARM wallet once it is 12 blocks deep. From there it can be tipped or
 * transferred through the mesh, or withdrawn to any Ethereum address.
 */
import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getColdKeyReceivingAddress } from "@/lib/blockchain/wallets/coldKey";
import { useWalletDialogTask } from "@/hooks/useWalletDialogTask";

export function EthereumEthActions({ userId, amount }: { userId: string; amount: number }) {
  const [open, setOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [addr, setAddr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    let active = true;
    void getColdKeyReceivingAddress(userId)
      .then((a) => { if (active) setAddr(a); })
      .catch(() => { if (active) setAddr(null); });
    return () => { active = false; };
  }, [open, userId]);

  const check = () => {
    setChecking(true);
    void import("@/lib/blockchain/wallets/nativeEth")
      .then((m) => m.syncNativeEthDeposits(userId))
      .then((n) => n > 0
        ? toast.success(`${n.toLocaleString(undefined, { maximumFractionDigits: 8 })} ETH added to your native wallet`)
        : toast.info("No new confirmed ETH yet. Ethereum needs about 12 blocks (under 3 minutes); it is also checked automatically."))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not check Ethereum right now."))
      .finally(() => setChecking(false));
  };

  return <>
    <Button type="button" size="sm" variant="outline" disabled={!userId} onClick={() => setOpen(true)}>
      <ArrowDownToLine className="mr-1 h-3 w-3" />Deposit
    </Button>
    <span title="Send ETH to any Ethereum address" className="inline-flex">
      <Button type="button" size="sm" variant="outline" disabled={!userId || amount <= 0} onClick={() => setSendOpen(true)}>
        <ArrowUpFromLine className="mr-1 h-3 w-3" />Withdraw
      </Button>
    </span>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Deposit ETH</DialogTitle></DialogHeader>
        <p role="note" className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs font-medium text-foreground">
          Only send ETH on Ethereum mainnet (chain 1).
        </p>
        <p className="text-xs text-muted-foreground">
          Send ETH from any Ethereum wallet to your receiving address. It is added to your native SWARM wallet once the transfer is 12 blocks deep, and you can then tip or transfer it to members. Keep a little here to pay gas when you withdraw Ethereum tokens.
        </p>
        {addr && <div className="mx-auto rounded-md border p-3"><QRCodeSVG value={addr} size={176} bgColor="#ffffff" fgColor="#000000" aria-label="Ethereum receiving address QR code" /></div>}
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 break-all rounded-md border p-2 font-mono text-xs">{addr ?? "Loading address…"}</span>
          <Button type="button" size="icon" variant="ghost" disabled={!addr} aria-label="Copy receiving address"
            onClick={() => addr && void navigator.clipboard.writeText(addr).then(() => toast.success("Receiving address copied"))}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <Button type="button" size="sm" variant="secondary" disabled={!addr || checking} onClick={check}>
          {checking ? "Checking Ethereum…" : "Check for my deposit"}
        </Button>
      </DialogContent>
    </Dialog>
    {sendOpen && <EthWithdrawDialog userId={userId} amount={amount} onDone={() => setSendOpen(false)} />}
  </>;
}

function EthWithdrawDialog({ userId, amount, onDone }: { userId: string; amount: number; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [dest, setDest] = useState("");
  const { busy, run } = useWalletDialogTask(true);
  const n = Number(value);
  const invalid = !/^0x[a-fA-F0-9]{40}$/.test(dest.trim()) || !Number.isFinite(n) || n <= 0 || n > amount;
  const submit = () => void run(
    async () => (await import("@/lib/blockchain/wallets/nativeEth")).withdrawNativeEth({ userId, to: dest.trim(), amount: n }),
    (hash) => { toast.success(`${n} ETH sent on Ethereum`, { description: `Ethereum tx ${hash.slice(0, 10)}…` }); onDone(); },
  );
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onDone(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Withdraw ETH to Ethereum</DialogTitle></DialogHeader>
        <p className="text-sm">Native balance: <b className="tabular-nums">{amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} ETH</b></p>
        <div className="space-y-1"><Label htmlFor="eth-wd-dest">Destination (Ethereum address)</Label>
          <Input id="eth-wd-dest" value={dest} disabled={busy} onChange={(e) => setDest(e.target.value)} className="font-mono text-xs" placeholder="0x…" /></div>
        <div className="space-y-1"><Label htmlFor="eth-wd-amt">Amount (ETH)</Label>
          <Input id="eth-wd-amt" type="number" inputMode="decimal" min="0" step="any" value={value} disabled={busy} onChange={(e) => setValue(e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">Your on-device wallet sends directly on Ethereum. The real gas used is taken from your ETH balance too, so leave a little for it. Transfers cannot be undone.</p>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>Close</Button>
          <Button type="button" disabled={busy || invalid} onClick={submit}>{busy ? "Signing with cold key…" : "Send on Ethereum"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
