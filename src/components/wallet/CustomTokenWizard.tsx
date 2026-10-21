/** Add Custom Token wizard (MetaMask tab): inform → details → verify/import → deposit now or later. */
import { useEffect, useState } from "react";
import { useWalletDialogTask } from "@/hooks/useWalletDialogTask";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, EyeOff, Coins, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useMetaMask } from "@/hooks/useMetaMask";
import { getLinkedWallet, linkMetaMaskWallet } from "@/lib/blockchain/wallets/walletLink";
import { MINTME_NETWORK, switchOrAddMintMeNetwork } from "@/lib/blockchain/wallets/mintmeNetwork";
import {
  importCustomTokenFromMetaMask, canHideToken, depositCustomToken, getRecordedTokenBalance, isContractAddress, isValidSymbol,
  listCustomTokens, readTokenBalance, readTokenDetails, unitsToNumber, setTokenHidden, CUSTOM_TOKENS_EVENT,
  CUSTOM_TOKEN_DEPOSIT_MAX, getCustomTokenDepositCapacity,
  type CustomToken,
} from "@/lib/blockchain/deposits/customTokens";

export function useCustomTokens(userId: string) {
  const [list, setList] = useState<CustomToken[]>(() => listCustomTokens(userId));
  useEffect(() => {
    const r = () => setList(listCustomTokens(userId));
    r();
    window.addEventListener(CUSTOM_TOKENS_EVENT, r);
    window.addEventListener("blockchain-transaction", r);
    return () => { window.removeEventListener(CUSTOM_TOKENS_EVENT, r); window.removeEventListener("blockchain-transaction", r); };
  }, [userId]);
  return list;
}

export function CustomTokenWizard({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState("");
  const [symbol, setSymbol] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ symbol: string; decimals: number; read: boolean } | null>(null);
  const [rawHeld, setRawHeld] = useState<bigint | null>(null);
  const [decimalsIn, setDecimalsIn] = useState("18");
  const [token, setToken] = useState<CustomToken | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const { address: mmAddr } = useMetaMask();

  const reset = () => { setStep(0); setAddress(""); setSymbol(""); setFound(null); setToken(null); setRawHeld(null); setDecimalsIn("18"); };
  const switchNet = async () => {
    setBusy(true);
    try {
      await switchOrAddMintMeNetwork();
      setStep(1);
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch to MintMe");
    }
    finally { setBusy(false); }
  };
  const check = async () => {
    setBusy(true);
    try {
      if (!mmAddr) throw new Error("Connect MetaMask before adding a token.");
      const meta = await readTokenDetails(address.trim(), mmAddr);
      const dec = meta.decimals ?? 18;
      const sym = meta.symbol ?? symbol.trim().toUpperCase();
      setFound({ symbol: sym, decimals: dec, read: meta.decimals != null });
      setDecimalsIn(String(dec));
      setRawHeld(meta.rawBalance);
      if (meta.symbol && meta.symbol.toUpperCase() !== symbol.trim().toUpperCase()) toast.warning(`The contract calls itself ${meta.symbol}, not ${symbol.toUpperCase()}.`);
      if (!meta.symbol || meta.decimals == null) toast.message("The contract didn't answer fully — check the details below.");
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check this token");
    } finally { setBusy(false); }
  };
  const dec = Number(decimalsIn);
  const decOk = Number.isInteger(dec) && dec >= 0 && dec <= 36;
  const importIt = async () => {
    if (!found || !decOk) return;
    setBusy(true);
    try {
      const t = await importCustomTokenFromMetaMask(userId, { address, symbol: found.symbol, decimals: dec });
      setToken(t); setStep(3);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Import failed"); }
    finally { setBusy(false); }
  };

  return <>
    <Button type="button" size="sm" variant="outline" disabled={!userId || !mmAddr} onClick={() => { reset(); setOpen(true); }}>
      <Plus className="mr-1 h-3 w-3" />Add custom token
    </Button>
    <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add a custom token · Step {step + 1} of 4</DialogTitle></DialogHeader>
        {step === 0 && <div className="space-y-3 text-sm">
          <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>You can add custom tokens from the <b className="text-foreground">MintMe blockchain only</b>.</li>
            <li>Custom tokens are imported through <b className="text-foreground">MetaMask</b>.</li>
            <li>Deposited tokens appear in your native wallet. Custom-token peer transfers and market payments are not available yet.</li>
            <li>Your native wallet only shows tokens you have <b className="text-foreground">deposited</b> to the network.</li>
            <li>Each contract has a <b className="text-foreground">{CUSTOM_TOKEN_DEPOSIT_MAX.toLocaleString()} total deposit ceiling</b> across the synced ledger, shared by all users — not a personal allowance.</li>
            <li>MintMe trading prices do not assign a SWARM value. Importing a token does not create liquidity or an exchange rate.</li>
          </ul>
          <a className="inline-flex items-center gap-1 text-xs text-primary underline" href={MINTME_NETWORK.blockExplorerUrls[0]} target="_blank" rel="noreferrer">
            Find a contract address on the MintMe explorer <ExternalLink className="h-3 w-3" />
          </a>
          <DialogFooter><Button type="button" disabled={busy} onClick={() => void switchNet()}>{busy ? "Waiting for MetaMask…" : "Continue"}</Button></DialogFooter>
        </div>}
        {step === 1 && <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="ct-addr">MintMe contract address</Label>
            <Input id="ct-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" className="font-mono text-xs" /></div>
          <div className="space-y-1"><Label htmlFor="ct-sym">Symbol</Label>
            <Input id="ct-sym" value={symbol} maxLength={11} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. MYTOKEN" /></div>
          <p className="text-xs text-muted-foreground">Read this token's balance through MetaMask on MintMe.</p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(0)}>Back</Button>
            <Button type="button" disabled={busy || !isContractAddress(address) || !isValidSymbol(symbol)} onClick={() => void check()}>{busy ? "Waiting for MetaMask…" : "Read token"}</Button>
          </DialogFooter>
        </div>}
        {step === 2 && found && <div className="space-y-3 text-sm">
          <div className="rounded-md border p-3 space-y-1">
            <div>Symbol: <b>{found.symbol}</b></div>
            <div>In your MetaMask: <b className="tabular-nums">{rawHeld == null || !decOk ? "couldn't read" : `${unitsToNumber(rawHeld, dec)} ${found.symbol}`}</b></div>
            <div className="break-all font-mono text-xs text-muted-foreground">{address.trim()}</div>
          </div>
          <div className="space-y-1"><Label htmlFor="ct-dec">Decimals {found.read ? "(from contract)" : "(enter manually — usually 18)"}</Label>
            <Input id="ct-dec" type="number" min="0" max="36" value={decimalsIn} disabled={found.read} onChange={(e) => setDecimalsIn(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">MetaMask keeps its token list private. Confirm this token in MetaMask before saving it here, even if already added. A zero balance is fine; nothing is sent.</p>
          <p className="text-xs text-muted-foreground">Remaining deposit capacity on this device's synced ledger: {getCustomTokenDepositCapacity(address).remaining.toLocaleString()} {found.symbol}. Withdrawals do not reset the ceiling; disconnected peers may have newer records.</p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(1)}>Back</Button>
            <Button type="button" disabled={busy || !decOk} onClick={() => void importIt()}>{busy ? "Waiting for MetaMask…" : "Import via MetaMask"}</Button>
          </DialogFooter>
        </div>}
        {step === 3 && token && <div className="space-y-3 text-sm">
          <p><b>{token.symbol}</b> is now on your MetaMask tab. Deposit it to see it in your native SWARM wallet.</p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Later</Button>
            <Button type="button" disabled={rawHeld == null || rawHeld <= 0n} onClick={() => { setOpen(false); setDepositOpen(true); }}>Deposit now</Button>
          </DialogFooter>
        </div>}
      </DialogContent>
    </Dialog>
    {token && <TokenDepositDialog userId={userId} token={token} open={depositOpen} onOpenChange={setDepositOpen} />}
  </>;
}

function TokenDepositDialog({ userId, token, open, onOpenChange }: { userId: string; token: CustomToken; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { address } = useMetaMask();
  const [amount, setAmount] = useState("");
  const { busy, run } = useWalletDialogTask(open);
  const [held, setHeld] = useState<number | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setLinked(getLinkedWallet(userId)?.address ?? null);
    let active = true;
    setHeld(null);
    if (address) void readTokenBalance(token, address).then((value) => { if (active) setHeld(value); }).catch(() => { if (active) setHeld(null); });
    return () => { active = false; };
  }, [open, userId, address, token]);
  const same = !!address && linked === address.toLowerCase();
  const n = Number(amount);
  const capacity = getCustomTokenDepositCapacity(token.address);
  const invalid = !Number.isFinite(n) || n <= 0 || held == null || n > held || n > capacity.remaining;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Deposit {token.symbol} from MetaMask</DialogTitle></DialogHeader>
      {!same ? <div className="space-y-2 text-sm">
        <p>Link your MetaMask account to your SWARM wallet first. You'll sign a message — no tokens move.</p>
        <DialogFooter><Button type="button" disabled={busy || !address} onClick={() => void run((signal) => linkMetaMaskWallet(userId, signal), (link) => setLinked(link.address))}>{busy ? "Confirm in MetaMask…" : "Link wallet"}</Button></DialogFooter>
      </div> : <div className="space-y-3">
        <p className="text-sm">In MetaMask: <b className="tabular-nums">{held == null ? "checking…" : `${held} ${token.symbol}`}</b></p>
        <Label htmlFor="ct-amt">Amount ({token.symbol})</Label>
        <Input id="ct-amt" type="number" inputMode="decimal" min="0" step="any" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
        <p className="text-xs text-muted-foreground">{capacity.deposited.toLocaleString()} of {capacity.max.toLocaleString()} deposited across the known ledger. Remaining: {capacity.remaining.toLocaleString()} {token.symbol}. This is shared across accounts, not per wallet.</p>
        {n > capacity.remaining && <p role="alert" className="text-sm text-destructive">Amount exceeds the remaining deposit capacity.</p>}
        <p className="text-xs text-muted-foreground">MetaMask confirms a transfer to your own linked address, then signs the deposit record. MetaMask is the only witness until a MintMe node can re-check it.</p>
        <DialogFooter><Button type="button" disabled={busy || invalid} onClick={() => void run(async () => {
          await depositCustomToken({ swarmId: userId, token, amount: n });
          }, () => { toast.success(`${n} ${token.symbol} recorded on your SWARM wallet`); setAmount(""); onOpenChange(false); })}>{busy ? "Confirm in MetaMask…" : "Deposit"}</Button></DialogFooter>
      </div>}
      {busy && <p role="status" className="text-xs text-muted-foreground">Waiting for MetaMask. Closing does not cancel a transfer already submitted to MetaMask.</p>}
      <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
    </DialogContent>
  </Dialog>;
}

/** Token row for either tab. Native shows only deposited tokens; MetaMask shows all non-hidden ones. */
export function CustomTokenRow({ userId, token, layer }: { userId: string; token: CustomToken; layer: "native" | "metamask" }) {
  const { address } = useMetaMask();
  const [held, setHeld] = useState<number | null>(null);
  const [dep, setDep] = useState(false);
  const recorded = getRecordedTokenBalance(userId, token.address);
  useEffect(() => { if (layer === "metamask" && address) void readTokenBalance(token, address).then(setHeld); }, [layer, address, token]);
  if (layer === "native" && recorded <= 0) return null;
  if (layer === "metamask" && token.hidden) return null;
  const amount = layer === "native" ? recorded : held;
  return <div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm font-medium"><Coins className="h-4 w-4 text-primary" /> {token.symbol} <span className="text-[10px] text-muted-foreground">MintMe token</span></div>
      <div className="text-xl font-semibold tabular-nums">{amount == null ? "…" : amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} <span className="text-xs font-normal text-muted-foreground">{token.symbol}</span></div>
    </div>
    {layer === "metamask" && <div className="grid grid-cols-2 gap-2 sm:flex">
      <Button type="button" size="sm" variant="outline" onClick={() => setDep(true)}>Deposit to Native</Button>
      {canHideToken(held, recorded) && <Button type="button" size="sm" variant="ghost" onClick={() => setTokenHidden(userId, token.address, true)}><EyeOff className="mr-1 h-3 w-3" />Hide</Button>}
      <TokenDepositDialog userId={userId} token={token} open={dep} onOpenChange={setDep} />
    </div>}
  </div>;
}
