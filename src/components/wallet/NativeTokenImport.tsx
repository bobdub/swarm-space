/** Add a MintMe or Ethereum custom token on the Native tab — reads the chain's public nodes, no MetaMask. */
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
import { TOKEN_NETWORKS, TOKEN_NETWORK_IDS, type TokenNetworkId } from "@/lib/blockchain/deposits/tokenNetworks";

/** `network` locks the dialog to one chain (the wallet's MintMe or Ethereum view); omitted, the member picks. */
export function NativeTokenImport({ userId, network: lockedNetwork }: { userId: string; network?: TokenNetworkId }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [network, setNetwork] = useState<TokenNetworkId>(lockedNetwork ?? "mintme");
  const net = TOKEN_NETWORKS[network];
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

  const reset = () => { setStep(0); setNetwork(lockedNetwork ?? "mintme"); setAddress(""); setSymbol(""); setDecimalsIn("18"); setFound(null); };

  const read = async () => {
    setBusy(true);
    try {
      const meta = await readTokenMetadataPublic(address, undefined, network);
      setFound(meta);
      if (meta.symbol) setSymbol(meta.symbol);
      if (meta.decimals != null) setDecimalsIn(String(meta.decimals));
      if (!meta.symbol || meta.decimals == null) toast.message("The contract didn't answer fully — check the details below.");
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not reach the ${net.label} network. Check your connection and try again.`);
    } finally {
      setBusy(false);
    }
  };

  const dec = Number(decimalsIn);
  const decOk = Number.isInteger(dec) && dec >= 0 && dec <= 36;

  const save = () => {
    try {
      const t = importCustomTokenFromMintMe(userId, { address, symbol, decimals: dec, ...(network === "mintme" ? {} : { network }) });
      toast.success(`${t.symbol} (${net.label}) added to your native wallet`, {
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
          <DialogHeader><DialogTitle>Add a {net.label} token · Step {step + 1} of 3</DialogTitle></DialogHeader>

          {step === 0 && (
            <div className="space-y-3 text-sm">
              {!lockedNetwork && <div className="space-y-1">
                <Label id="nt-net-label">Network</Label>
                <div role="radiogroup" aria-labelledby="nt-net-label" className="grid grid-cols-2 gap-2">
                  {TOKEN_NETWORK_IDS.map((id) => (
                    <Button
                      key={id} type="button" size="sm" role="radio" aria-checked={network === id}
                      variant={network === id ? "default" : "outline"} onClick={() => setNetwork(id)}
                    >
                      {TOKEN_NETWORKS[id].label}
                    </Button>
                  ))}
                </div>
              </div>}
              <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>Add tokens from the <b className="text-foreground">{net.label} blockchain</b>{network === "ethereum" ? " (mainnet, ERC-20)" : ""} by contract address — no MetaMask needed.</li>
                <li>The app reads the token's details from {net.label}'s public nodes.</li>
                <li>Send the token to your native receiving address from any {net.label} wallet; it appears here once the transfer confirms.</li>
                {network === "ethereum" && <li>Withdrawing back to Ethereum later needs a little <b className="text-foreground">ETH for gas</b> at your receiving address.</li>}
                <li>Each contract has a <b className="text-foreground">{CUSTOM_TOKEN_DEPOSIT_MAX.toLocaleString()} total deposit ceiling</b> shared by all users.</li>
              </ul>
              <div className="space-y-1">
                <Label>Your native receiving address ({net.label})</Label>
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
                href={net.explorerUrl} target="_blank" rel="noreferrer"
              >
                Find a contract address on the {net.label} explorer <ExternalLink className="h-3 w-3" />
              </a>
              <DialogFooter><Button type="button" onClick={() => setStep(1)}>Continue</Button></DialogFooter>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="nt-addr">{net.label} contract address</Label>
                <Input
                  id="nt-addr" value={address} onChange={(e) => setAddress(e.target.value)}
                  placeholder="0x…" className="font-mono text-xs"
                />
              </div>
              <p className="text-xs text-muted-foreground">The app asks {net.label}'s public nodes for this token's symbol and decimals.</p>
              <DialogFooter className="gap-2">
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(0)}>Back</Button>
                <Button type="button" disabled={busy || !isContractAddress(address)} onClick={() => void read()}>
                  {busy ? `Reading ${net.label}…` : "Read token"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 2 && found && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border p-3 space-y-1">
                <div>
                  {net.label} contract answered: <b>{found.symbol ?? "no symbol"}</b>
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
