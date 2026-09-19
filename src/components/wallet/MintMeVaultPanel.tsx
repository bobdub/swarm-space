import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link2, Send, ArrowDownToLine, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/lib/auth";
import {
  getMetaMaskAccount,
  getMetaMaskChainId,
  onMetaMaskChange,
} from "@/lib/blockchain/wallets/metaMaskBridge";
import { MINTME_NETWORK, isMintMeChain, switchToMintMeNetwork } from "@/lib/blockchain/wallets/mintmeNetwork";
import { sendMintMe } from "@/lib/blockchain/wallets/mintmeBridge";
import {
  getLinkedWallet,
  linkMetaMaskWallet,
  unlinkMetaMaskWallet,
  type WalletLink,
} from "@/lib/blockchain/wallets/walletLink";
import {
  depositMintMe,
  getChainMintmeBalance,
  migrateLocalMintMe,
  recordMintMeWithdrawal,
  reconcileMintMe,
  type ReconcileResult,
} from "@/lib/blockchain/deposits/mintmeDeposit";

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function MintMeVaultPanel() {
  const user = getCurrentUser();
  const userId = user?.id ?? "";
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [link, setLink] = useState<WalletLink | null>(() => (userId ? getLinkedWallet(userId) : null));
  const [recorded, setRecorded] = useState(() => (userId ? getChainMintmeBalance(userId) : 0));
  const [check, setCheck] = useState<ReconcileResult | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [depAmount, setDepAmount] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");

  const refreshWallet = useCallback(async () => {
    const [acct, chain] = await Promise.all([getMetaMaskAccount(), getMetaMaskChainId()]);
    setAccount(acct);
    setChainId(chain);
  }, []);

  const refreshChain = useCallback(() => {
    if (!userId) return;
    setLink(getLinkedWallet(userId));
    setRecorded(getChainMintmeBalance(userId));
  }, [userId]);

  useEffect(() => {
    void refreshWallet();
    return onMetaMaskChange(() => { void refreshWallet(); });
  }, [refreshWallet]);

  useEffect(() => {
    refreshChain();
    const onTx = () => refreshChain();
    window.addEventListener("blockchain-transaction", onTx);
    return () => window.removeEventListener("blockchain-transaction", onTx);
  }, [refreshChain]);

  // Carry any leftover side-ledger MintMe onto the chain once bound.
  useEffect(() => {
    if (!userId || !link) return;
    void migrateLocalMintMe(userId).then((moved) => {
      if (moved > 0) {
        toast.message("Old MintMe balance carried onto the chain", {
          description: `${moved.toFixed(6)} MINTME recorded against your linked wallet.`,
        });
        refreshChain();
      }
    });
  }, [userId, link, refreshChain]);

  const runCheck = useCallback(async (write: boolean) => {
    if (!userId || !link) return;
    const result = await reconcileMintMe(userId, { write });
    setCheck(result);
    setCheckedAt(new Date().toLocaleTimeString());
    if (result.adjusted) {
      toast.warning("Backing reduced", {
        description: "Your wallet holds less than the chain recorded — a reconcile entry was written.",
      });
    }
    refreshChain();
  }, [userId, link, refreshChain]);

  useEffect(() => {
    if (link && isMintMeChain(chainId)) void runCheck(false);
  }, [link, chainId, runCheck]);

  const doLink = async () => {
    setBusy(true);
    try {
      const created = await linkMetaMaskWallet(userId);
      setLink(created);
      toast.success("Wallet linked", { description: `${shortAddr(created.address)} signed for this Swarm identity.` });
      refreshChain();
    } catch (e) {
      toast.error("Link failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const doDeposit = async () => {
    const amt = Number(depAmount);
    setBusy(true);
    try {
      await depositMintMe({ swarmId: userId, amount: amt });
      toast.success("MintMe deposit recorded", { description: `${amt} MINTME now on your Swarm wallet.` });
      setDepAmount("");
      refreshChain();
      void runCheck(false);
    } catch (e) {
      toast.error("Deposit failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const doSend = async () => {
    const amt = Number(sendAmount);
    if (!(amt > 0)) { toast.error("Enter a positive MINTME amount"); return; }
    setBusy(true);
    try {
      const hash = await sendMintMe({ to: sendTo.trim(), amountEth: amt });
      await recordMintMeWithdrawal({ swarmId: userId, amount: amt, to: sendTo.trim(), txHash: hash });
      toast.success("MintMe sent", { description: `tx ${shortAddr(hash)}` });
      setSendAmount(""); setSendTo("");
      refreshChain();
      setTimeout(() => { void runCheck(false); }, 1500);
    } catch (e) {
      toast.error("Send failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const onLinkedAccount = !!link && !!account && link.address === account.toLowerCase();
  const shortfall = check && check.observed != null && check.drift < -1e-8;

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-xs text-muted-foreground">MintMe on your Swarm wallet</div>
          <div className="font-semibold">
            {recorded.toFixed(6)} MINTME
            <span className="ml-2 text-[10px] text-muted-foreground">recorded on the Swarm chain</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {check?.observed != null
              ? `Wallet reports ${check.observed.toFixed(6)} MINTME${checkedAt ? ` · checked ${checkedAt}` : ""}`
              : "Wallet reading not available yet"}
          </div>
        </div>
        <div className="flex gap-1">
          {link && (
            <Badge variant="secondary" className="text-[9px]">
              <ShieldCheck className="mr-1 h-3 w-3" /> {shortAddr(link.address)}
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={() => void runCheck(true)} disabled={!link || busy}>
            <RefreshCw className="mr-1 h-3 w-3" /> Check
          </Button>
        </div>
      </div>

      {shortfall && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px]">
          <AlertTriangle className="mr-1 inline h-3 w-3 text-destructive" />
          Backing reduced — your wallet holds less than the chain recorded. The
          difference is written down rather than quietly erased.
        </div>
      )}

      {!link && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Sign once in MetaMask to prove this wallet is yours. It moves no
            funds, and the proof lives on the Swarm chain so any peer can check it.
          </p>
          <Button size="sm" onClick={doLink} disabled={!account || busy}>
            <Link2 className="mr-1 h-3 w-3" /> Link this wallet
          </Button>
          {!account && <div className="text-[10px] text-muted-foreground">Connect MetaMask first.</div>}
        </div>
      )}

      {link && !onLinkedAccount && (
        <div className="text-[11px] text-muted-foreground">
          MetaMask is on a different account. Switch back to {shortAddr(link.address)}, or
          <Button variant="link" size="sm" className="px-1 text-[11px]" onClick={() => { unlinkMetaMaskWallet(userId); refreshChain(); }}>
            unlink
          </Button>
          and link the new one.
        </div>
      )}

      {link && onLinkedAccount && !isMintMeChain(chainId) && (
        <Button size="sm" variant="outline" onClick={() => switchToMintMeNetwork().catch(() => {})}>
          Switch MetaMask to MintMe
        </Button>
      )}

      {link && onLinkedAccount && (
        <>
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs">Deposit MintMe into your Swarm wallet</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Amount MINTME"
                inputMode="decimal"
                value={depAmount}
                onChange={(e) => setDepAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              />
              <Button type="button" onClick={doDeposit} disabled={busy || !(Number(depAmount) > 0)}>
                <ArrowDownToLine className="mr-1 h-3 w-3" /> Deposit
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              MetaMask signs the transfer on the MintMe chain and the amount is
              written onto the Swarm chain with the transaction hash and your
              signature. Your coins never leave your own wallet.
            </p>
          </div>

          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs">Send MintMe to a peer</Label>
            <Input placeholder="0x… recipient" value={sendTo} onChange={(e) => setSendTo(e.target.value)} />
            <div className="flex gap-2">
              <Input
                placeholder="Amount MINTME"
                inputMode="decimal"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              />
              <Button type="button" onClick={doSend} disabled={busy}>
                <Send className="mr-1 h-3 w-3" /> Send
              </Button>
            </div>
          </div>
        </>
      )}

      <div className="text-[10px] text-muted-foreground">
        Network: {MINTME_NETWORK.chainName} (chain {MINTME_NETWORK.chainId}). No
        custodian and no server — MetaMask signs, the mesh keeps the record.
      </div>
    </div>
  );
}
