/**
 * NetworkActionDialogs — network-aware Receive / Transfer actions for
 * MintMe-family assets (native MINTME and imported MintMe tokens).
 *
 * Actions follow the shared wallet network selector:
 * - SWARM: native mesh receiving address and online-peer transfers.
 * - MintMe: deposit to the cold-key receiving address / cold-key withdrawal.
 * - Custom Chain: shown only when the user has deployed a sub-chain on
 *   SWARM; MintMe assets cannot move onto a SWARM sub-chain, so the panel
 *   explains that instead of offering a transfer.
 */
import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeTokenDepositDialog } from "./NativeTokenDepositDialog";
import { NativeTransferDialog } from "./NativeTransferDialog";
import { MintMeWithdrawDialog } from "./MintMeWithdrawDialog";

export type AssetNetwork = "swarm" | "mintme" | `chain:${string}`;

/** Compact actions follow the wallet's shared network selection. */
export function MintMeNativeActions({ userId, amount, network = "swarm" }: { userId: string; amount: number; network?: AssetNetwork }) {
  const [receiveOpen, setReceiveOpen] = useState(false);
  if (network.startsWith("chain:")) return <>
    <Button type="button" variant="outline" size="sm" disabled title="MINTME cannot settle on a SWARM sub-chain"><ArrowDownToLine className="mr-1 h-3 w-3" />Receive</Button>
    <Button type="button" variant="outline" size="sm" disabled title="MINTME cannot settle on a SWARM sub-chain"><ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer</Button>
  </>;
  if (network === "mintme") return <>
    <NativeTokenDepositDialog userId={userId} symbol="MINTME" />
    <span title="Only transfer to wallets that support the MintMe chain" className="inline-flex"><MintMeWithdrawDialog userId={userId} amount={amount} /></span>
  </>;
  return <>
    <Button type="button" variant="outline" size="sm" disabled={!userId} onClick={() => setReceiveOpen(true)}><ArrowDownToLine className="mr-1 h-3 w-3" />Receive</Button>
    <span title="Only transfer to online peers on SWARM" className="inline-flex"><NativeTransferDialog userId={userId} assetId="external:MINTME" assetLabel="MINTME" amount={amount} /></span>
    {receiveOpen && <NativeSwarmReceiveDialog userId={userId} label="MINTME" open={receiveOpen} onOpenChange={setReceiveOpen} />}
  </>;
}

export function CustomTokenNetworkActions({ userId, symbol, address, recorded, network = "swarm", renderWithdrawForm }: {
  userId: string; symbol: string; address: string; recorded: number; network?: AssetNetwork;
  renderWithdrawForm: (onDone: () => void) => React.ReactNode;
}) {
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  if (network.startsWith("chain:")) return <>
    <Button type="button" variant="outline" size="sm" disabled title="MintMe tokens cannot settle on a SWARM sub-chain"><ArrowDownToLine className="mr-1 h-3 w-3" />Receive</Button>
    <Button type="button" variant="outline" size="sm" disabled title="MintMe tokens cannot settle on a SWARM sub-chain"><ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer</Button>
  </>;
  return <>
    {network === "mintme" ? <NativeTokenDepositDialog userId={userId} symbol={symbol} /> :
      <Button type="button" variant="outline" size="sm" disabled={!userId} onClick={() => setReceiveOpen(true)}><ArrowDownToLine className="mr-1 h-3 w-3" />Receive</Button>}
    {network === "swarm" ? <span title="Only transfer to online peers on SWARM" className="inline-flex"><NativeTransferDialog userId={userId} assetId={`custom:${address}`} assetLabel={symbol} amount={recorded} /></span> :
      <Button type="button" variant="outline" size="sm" disabled={!userId || recorded <= 0} title="Only transfer to wallets that support the MintMe chain" onClick={() => setSendOpen(true)}><ArrowUpFromLine className="mr-1 h-3 w-3" />Withdraw</Button>}
    {sendOpen && network === "mintme" && renderWithdrawForm(() => setSendOpen(false))}
    {receiveOpen && <NativeSwarmReceiveDialog userId={userId} label={symbol} open={receiveOpen} onOpenChange={setReceiveOpen} />}
  </>;
}

/** Minimal native-address receive dialog (QR + copy) reused for the MINTME row. */
import { QRCodeSVG } from "qrcode.react";
import { Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useNativeWalletAddress } from "@/hooks/useNativeWalletAddress";

function NativeSwarmReceiveDialog({ userId, label, open, onOpenChange }: {
  userId: string; label: string; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const addr = useNativeWalletAddress(userId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Receive {label}</DialogTitle></DialogHeader>
        {addr && <div className="mx-auto rounded-md border p-3"><QRCodeSVG value={addr} size={176} bgColor="#ffffff" fgColor="#000000" aria-label="Native wallet address QR code" /></div>}
        <Label>Your native SWARM wallet address</Label>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 break-all font-mono text-xs">{addr || "Loading address…"}</span>
          <Button type="button" size="icon" variant="ghost" disabled={!addr} aria-label="Copy address"
            onClick={() => void navigator.clipboard.writeText(addr).then(() => toast.success("Wallet address copied"))}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Receive {label} on SWARM at this address.</p>
      </DialogContent>
    </Dialog>
  );
}
