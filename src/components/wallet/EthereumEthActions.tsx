/**
 * ETH on the wallet's Ethereum view. The cold-key receiving address is the
 * same on Ethereum and MintMe; ETH sent there pays gas when Ethereum tokens
 * (such as MTCG) are withdrawn. The live on-chain balance is read from public
 * mainnet nodes. ETH itself is not credited to the native ledger, so it cannot
 * be transferred through the mesh.
 */
import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Copy, RefreshCw } from "lucide-react";
import { formatEther } from "ethers";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getColdKeyReceivingAddress } from "@/lib/blockchain/wallets/coldKey";

export const ETH_TRANSFER_HINT = "ETH at your receiving address pays gas for Ethereum token withdrawals. Mesh transfers of ETH are not available yet.";

async function readOnChainEth(address: string): Promise<string> {
  const { ethereumFallbackProvider } = await import("@/lib/blockchain/wallets/ethereumRpc");
  const provider = ethereumFallbackProvider();
  try { return formatEther(await provider.getBalance(address)); } finally { provider.destroy(); }
}

export function EthereumEthActions({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [addr, setAddr] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
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
    if (!addr) return;
    setChecking(true);
    void readOnChainEth(addr)
      .then(setBalance)
      .catch(() => toast.error("Could not reach the Ethereum network right now."))
      .finally(() => setChecking(false));
  };

  return <>
    <Button type="button" size="sm" variant="outline" disabled={!userId} onClick={() => setOpen(true)}>
      <ArrowDownToLine className="mr-1 h-3 w-3" />Deposit
    </Button>
    <span title={ETH_TRANSFER_HINT} className="inline-flex opacity-50">
      <Button type="button" size="sm" variant="outline" disabled className="pointer-events-none w-full"><ArrowUpFromLine className="mr-1 h-3 w-3" />Transfer</Button>
    </span>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Deposit ETH</DialogTitle></DialogHeader>
        <p role="note" className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs font-medium text-foreground">
          Only send ETH on Ethereum mainnet (chain 1).
        </p>
        <p className="text-xs text-muted-foreground">
          ETH at your receiving address pays the gas when you withdraw Ethereum tokens such as MTCG. It stays on Ethereum at this address and is not added to your native wallet balance.
        </p>
        {addr && <div className="mx-auto rounded-md border p-3"><QRCodeSVG value={addr} size={176} bgColor="#ffffff" fgColor="#000000" aria-label="Ethereum receiving address QR code" /></div>}
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 break-all rounded-md border p-2 font-mono text-xs">{addr ?? "Loading address…"}</span>
          <Button type="button" size="icon" variant="ghost" disabled={!addr} aria-label="Copy receiving address"
            onClick={() => addr && void navigator.clipboard.writeText(addr).then(() => toast.success("Receiving address copied"))}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>On-chain ETH: <b className="tabular-nums">{balance == null ? "—" : Number(balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</b></span>
          <Button type="button" size="sm" variant="secondary" disabled={!addr || checking} onClick={check}>
            <RefreshCw className={`mr-1 h-3 w-3${checking ? " animate-spin" : ""}`} />{checking ? "Checking Ethereum…" : "Check balance"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
