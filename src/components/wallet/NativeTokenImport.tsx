/** Add a MintMe custom token directly on the Native tab — reads MintMe's public nodes, no MetaMask. */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { importCustomTokenFromMintMe, readTokenMetadataPublic } from "@/lib/blockchain/deposits/nativeTokenImport";
import { isContractAddress, isValidSymbol, CUSTOM_TOKEN_DEPOSIT_MAX } from "@/lib/blockchain/deposits/customTokens";
import { getColdKeyReceivingAddress } from "@/lib/blockchain/wallets/coldKey";
import { MINTME_NETWORK } from "@/lib/blockchain/wallets/mintmeNetwork";

export function NativeTokenImport({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState("");
  const [symbol, setSymbol] = useState("");
  const [decimalsIn, setDecimalsIn] = useState("18");
  const [found, setFound] = useState<{ symbol: string | null; decimals: number | null } | null>(null);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    let active = true;
    void getColdKeyReceivingAddress(userId)
      .then((a) => { if (active) setReceiving(a); })
      .catch(() => { if (active) setReceiving(null); });
    return () => { active = false; };
  }, [open, userId]);

  const reset = () => { setStep(0); setAddress(""); setSymbol(""); setDecimalsIn("18"); setFound(null); };

  const read = async () => {
    setBusy(true);
    try {
      const meta = await readTokenMetadataPublic(address);
      setFound(meta);
      if (meta.symbol) setSymbol(meta.symbol);
      if (meta.decimals != null) setDecimalsIn(String(meta.decimals));
      if (!meta.symbol || meta.decimals == null) toast.message("The contract didn't answer fully — check the details below.");
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach the MintMe network. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const dec = Number(decimalsIn);
  const decOk = Number.isInteger(dec) && dec >= 0 && dec <= 36;

  const save = () => {
    try {
      const t = importCustomTokenFromMintMe(userId, { address, symbol, decimals: dec });
      toast.success(`${t.symbol} added to your native wallet`, {
        description: "It shows a balance once tokens arrive at your native receiving address.",
      });
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save this token");
    }
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={!userId} onClick={() => { reset(); setOpen(true); }}>
        <Plus className="mr-1 h-3 w-3" />Add custom token
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add a MintMe token · Step {step + 1} of 3</DialogTitle></DialogHeader>

          {step === 0 && (
            <div className="space-y-3 text-sm">
              <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>Add tokens from the <b className="text-foreground">MintMe blockchain</b> by contract address — no MetaMask needed.</li>
                <li>The app reads the token's details from MintMe's public nodes.</li>
                <li>Send the token to your native receiving address from any MintMe wallet; it appears here once the transfer confirms.</li>
                <li>Each contract has a <b className="text-foreground">{CUSTOM_TOKEN_DEPOSIT_MAX.toLocaleString()} total deposit ceiling</b> shared by all users.</li>
              </ul>
              <div className="space-y-1">
                <Label>Your native receiving address (MintMe)</Label>
                {receiving ? (
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 break-all rounded-md border p-2 font-mono text-xs">{receiving}</span>
                    <Button
                      type="button" size="icon" variant="ghost" aria-label="Copy receiving address"
                      onClick={() => void navigator.clipboard.writeText(receiving).then(() => toast.success("Receiving address copied"))}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Your receiving address appears once your signing session is unlocked.</p>
                )}
              </div>
              <a
                className="inline-flex items-center gap-1 text-xs text-primary underline"
                href={MINTME_NETWORK.blockExplorerUrls[0]} target="_blank" rel="noreferrer"
              >
                Find a contract address on the MintMe explorer <ExternalLink className="h-3 w-3" />
              </a>
              <DialogFooter><Button type="button" onClick={() => setStep(1)}>Continue</Button></DialogFooter>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="nt-addr">MintMe contract address</Label>
                <Input
                  id="nt-addr" value={address} onChange={(e) => setAddress(e.target.value)}
                  placeholder="0x…" className="font-mono text-xs"
                />
              </div>
              <p className="text-xs text-muted-foreground">The app asks MintMe's public nodes for this token's symbol and decimals.</p>
              <DialogFooter className="gap-2">
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(0)}>Back</Button>
                <Button type="button" disabled={busy || !isContractAddress(address)} onClick={() => void read()}>
                  {busy ? "Reading MintMe…" : "Read token"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 2 && found && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border p-3 space-y-1">
                <div>
                  Contract answered: <b>{found.symbol ?? "no symbol"}</b>
                  {found.decimals != null ? ` · ${found.decimals} decimals` : ""}
                </div>
                <div className="break-all font-mono text-xs text-muted-foreground">{address.trim()}</div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="nt-sym">Symbol {found.symbol ? "(from contract)" : "(enter manually)"}</Label>
                <Input
                  id="nt-sym" value={symbol} maxLength={11} disabled={!!found.symbol}
                  onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. MYTOKEN"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="nt-dec">Decimals {found.decimals != null ? "(from contract)" : "(enter manually — usually 18)"}</Label>
                <Input
                  id="nt-dec" type="number" min="0" max="36" value={decimalsIn}
                  disabled={found.decimals != null} onChange={(e) => setDecimalsIn(e.target.value)}
                />
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="ghost" onClick={() => setStep(1)}>Back</Button>
                <Button type="button" disabled={!isValidSymbol(symbol) || !decOk} onClick={save}>Save token</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
