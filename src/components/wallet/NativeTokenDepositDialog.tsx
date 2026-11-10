/**
 * NativeTokenDepositDialog — deposit info for an imported MintMe token.
 *
 * Shows the owner's cold-key receiving address (QR + copy) so tokens can be
 * sent from any MintMe wallet. No MetaMask involved; the balance appears
 * once a confirmed MintMe transfer to this address is recorded.
 */
import { useEffect, useState } from "react";
import { ArrowDownToLine, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { getColdKeyReceivingAddress } from "@/lib/blockchain/wallets/coldKey";

export function NativeTokenDepositDialog({ userId, symbol }: { userId: string; symbol: string }) {
  const [open, setOpen] = useState(false);
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

  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={!userId} title="Only receive imported assets already on SWARM" onClick={() => setOpen(true)}>
        <ArrowDownToLine className="mr-1 h-3 w-3" />Deposit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Deposit {symbol}</DialogTitle></DialogHeader>
          <p role="note" className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs font-medium text-foreground">
            Only deposit MintMe tokens on the MintMe blockchain.
          </p>
          <p className="text-xs text-muted-foreground">
            Send {symbol} from any MintMe wallet to your native receiving address. It appears here once the transfer confirms on MintMe — tokens sent on any other network are lost.
          </p>
          {addr && (
            <div className="mx-auto rounded-md border p-3">
              <QRCodeSVG value={addr} size={176} bgColor="#ffffff" fgColor="#000000" aria-label="Native receiving address QR code" />
            </div>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 break-all rounded-md border p-2 font-mono text-xs">{addr ?? "Loading address…"}</span>
            <Button type="button" size="icon" variant="ghost" disabled={!addr} aria-label="Copy receiving address"
              onClick={() => addr && void navigator.clipboard.writeText(addr).then(() => toast.success("Receiving address copied"))}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {symbol === "MINTME" && (
            <Button type="button" size="sm" variant="secondary" disabled={!addr || checking} onClick={() => {
              setChecking(true);
              void import("@/lib/blockchain/wallets/nativeMintmeDirect").then(m => m.syncNativeMintMeDeposits(userId))
                .then(n => n > 0 ? toast.success(`${n} MINTME added to your native wallet`) : toast.info("No new confirmed MINTME yet. It is checked automatically every couple of minutes."))
                .catch(e => toast.error(e instanceof Error ? e.message : "Could not check MintMe right now."))
                .finally(() => setChecking(false));
            }}>{checking ? "Checking MintMe…" : "Check for my deposit"}</Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
