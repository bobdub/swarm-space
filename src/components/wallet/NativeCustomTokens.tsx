/** Native custom-token inventory and direct MintMe withdrawals. */
import { useEffect, useState } from "react";
import { useWalletDialogTask } from "@/hooks/useWalletDialogTask";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EyeOff, Trash2, Coins } from "lucide-react";
import { toast } from "sonner";
import { DEPOSIT_SYNC_EVENT } from "@/lib/blockchain/deposits/depositSync";
import { removeCustomToken, getRecordedTokenBalance, getPendingSyncTokenBalance, syncPendingDeposits,
  isContractAddress, listCustomTokens, CUSTOM_TOKENS_EVENT, hydrateCustomTokens, withdrawCustomToken,
  type CustomToken } from "@/lib/blockchain/deposits/customTokens";
import { COLD_KEY_ENGRAVING_SWARM, engraveColdKey, getColdKeyAuthority, type ColdKeyAuthority } from "@/lib/blockchain/wallets/coldKey";
import { getCachedPrivateKey, getCurrentUser } from "@/lib/auth";
import { CustomTokenNetworkActions, type AssetNetwork } from "./NetworkActionDialogs";

export function useCustomTokens(userId: string) {
  const [list, setList] = useState<CustomToken[]>(() => listCustomTokens(userId));
  useEffect(() => {
    const r = () => setList(listCustomTokens(userId));
    r();
    void hydrateCustomTokens(userId).then(setList);
    window.addEventListener(CUSTOM_TOKENS_EVENT, r);
    window.addEventListener("blockchain-transaction", r);
    return () => { window.removeEventListener(CUSTOM_TOKENS_EVENT, r); window.removeEventListener("blockchain-transaction", r); };
  }, [userId]);
  return list;
}

/** Imported tokens remain visible until their owner hides or removes them. */
export function CustomTokenRow({ userId, token, layer, network = "swarm", onHide }: { userId: string; token: CustomToken; layer: "native"; network?: AssetNetwork; onHide?: () => void }) {
  const recorded = getRecordedTokenBalance(userId, token.address);
  const pendingSync = layer === "native" ? getPendingSyncTokenBalance(userId, token.address) : 0;
  const [, bump] = useState(0);
  useEffect(() => {
    if (layer !== "native" || pendingSync <= 0) return;
    const onSync = () => bump((n) => n + 1);
    window.addEventListener(DEPOSIT_SYNC_EVENT, onSync);
    const t = window.setInterval(() => void syncPendingDeposits(userId), 10_000);
    void syncPendingDeposits(userId);
    return () => { window.removeEventListener(DEPOSIT_SYNC_EVENT, onSync); window.clearInterval(t); };
  }, [layer, pendingSync, userId]);
  const amount = recorded;
  return <div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm font-medium"><Coins className="h-4 w-4 text-primary" /> {token.symbol} <span className="text-[10px] text-muted-foreground">MintMe token</span></div>
      <div className="text-xl font-semibold tabular-nums">{amount == null ? "…" : amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} <span className="text-xs font-normal text-muted-foreground">{token.symbol}</span></div>
      {pendingSync > 0 && <div className="text-xs text-muted-foreground" title="Confirmed on MintMe. Usable in the mesh once shared with a peer; you can withdraw it to a MintMe address.">
        {pendingSync.toLocaleString(undefined, { maximumFractionDigits: 6 })} pending sync · {Math.max(0, recorded - pendingSync).toLocaleString(undefined, { maximumFractionDigits: 6 })} available
      </div>}
    </div>
    {layer === "native" && <div className="grid grid-cols-2 gap-2 sm:flex">
      <CustomTokenNetworkActions userId={userId} symbol={token.symbol} address={token.address} recorded={recorded}
        network={network}
        renderWithdrawForm={(onDone) => (
          <Dialog open onOpenChange={(v) => { if (!v) onDone(); }}>
            <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
              <WithdrawForm userId={userId} token={token} recorded={recorded} onDone={onDone} />
            </DialogContent>
          </Dialog>
        )} />
      {onHide && <Button type="button" size="sm" variant="ghost" onClick={onHide}><EyeOff className="mr-1 h-3 w-3" />Hide</Button>}
      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => {
        const note = recorded > 0 ? ` Your ${recorded} ${token.symbol} stays recorded and returns when you add the token again.` : "";
        if (window.confirm(`Remove ${token.symbol} from your wallet list?${note}`)) { removeCustomToken(userId, token.address); toast.success(`${token.symbol} removed`); }
      }}><Trash2 className="mr-1 h-3 w-3" />Delete</Button>
    </div>}
  </div>;
}

/** Cold-key withdrawal form — sends the token to any MintMe address. Mounted only while shown. */
export function WithdrawForm({ userId, token, recorded, onDone }: {
  userId: string; token: CustomToken; recorded: number; onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState("");
  const [authority, setAuthority] = useState<ColdKeyAuthority | null | undefined>(undefined);
  const { busy, run } = useWalletDialogTask(true);
  useEffect(() => {
    setAuthority(undefined);
    void getColdKeyAuthority(userId).then(setAuthority);
  }, [userId]);
  const n = Number(amount);
  const invalid = !isContractAddress(dest) || !Number.isFinite(n) || n <= 0 || n > recorded;
  const engrave = () => void run(async () => {
    await engraveColdKey(userId);
    setAuthority(await getColdKeyAuthority(userId));
  }, () => toast.success("Cold-wallet key engraved", { description: `${COLD_KEY_ENGRAVING_SWARM} mined SWARM is locked in its container — never burned.` }));
  const submit = () => void run(async () => {
    if (!await getCachedPrivateKey()) throw new Error("Your signing vault is locked. Sign in again to unlock it; no tokens have moved.");
    if (getCurrentUser()?.id !== userId) throw new Error("Sign in with the account belonging to this wallet");
    return withdrawCustomToken({ swarmId: userId, token, amount: n, to: dest.trim() });
  }, (tx) => {
    toast.success(`${n} ${token.symbol} sent to MintMe`, { description: `MintMe tx ${String(tx.signature).slice(0, 10)}… · appears under the MintMe network` });
    setAmount(""); onDone();
  });
  return (
    <>
      <DialogHeader><DialogTitle>Send {token.symbol} to MintMe</DialogTitle></DialogHeader>
      {authority === undefined ? <p className="text-sm text-muted-foreground">Checking your cold-wallet key…</p>
        : !authority ? <div className="space-y-3 text-sm">
          <p>A cold-wallet key signs withdrawals out of your native wallet. You don't have one yet.</p>
          <p className="text-xs text-muted-foreground">Engraving a key locks {COLD_KEY_ENGRAVING_SWARM} mined SWARM into a sealed container — it is never burned. If you later create a Creator Coin Vault, it acts as your key instead.</p>
          <DialogFooter><Button type="button" disabled={busy} onClick={engrave}>{busy ? "Engraving…" : `Engrave key · ${COLD_KEY_ENGRAVING_SWARM} SWARM`}</Button></DialogFooter>
        </div>
        : <div className="space-y-3">
          <p className="text-sm">Native balance: <b className="tabular-nums">{recorded.toLocaleString(undefined, { maximumFractionDigits: 6 })} {token.symbol}</b> <span className="text-[10px] text-muted-foreground">· key: {authority.kind === "vault" ? "Creator Coin Vault" : "engraved cold key"}</span></p>
          <div className="space-y-1"><Label htmlFor="ct-wd-dest">Destination (MintMe address)</Label>
            <Input id="ct-wd-dest" value={dest} disabled={busy} onChange={(e) => setDest(e.target.value)} className="font-mono text-xs" placeholder="0x…" />
            <p className="text-[10px] text-muted-foreground">Use an address that accepts this token on MintMe. Transfers cannot be undone.</p></div>
          <div className="space-y-1"><Label htmlFor="ct-wd-amt">Amount ({token.symbol})</Label>
            <Input id="ct-wd-amt" type="number" inputMode="decimal" min="0" step="any" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">Your on-device wallet sends directly to MintMe. Your receiving address needs MINTME for gas; you can fund it from any MintMe wallet. The native balance is debited only after the outgoing transfer is accepted.</p>
          <DialogFooter className="gap-2">
            <Button type="button" disabled={busy || invalid} onClick={submit}>{busy ? "Signing with cold key…" : "Send to MintMe"}</Button>
          </DialogFooter>
        </div>}
      <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>Close</Button>
    </>
  );
}
