import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet as WalletIcon, ArrowDownToLine, ArrowUpFromLine, ShieldAlert, Link2, Send } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/lib/auth";
import {
  getAppWalletBalances,
  onAppWalletUpdate,
  type AppWalletCurrency,
} from "@/lib/blockchain/wallets/appWallet";
import {
  connectMetaMask,
  getMetaMaskAccount,
  getMetaMaskChainId,
  isMetaMaskAvailable,
  onMetaMaskChange,
  requestMetaMask,
} from "@/lib/blockchain/wallets/metaMaskBridge";
import {
  SWARM_EVM_CHAIN_ID_HEX,
  isSwarmChain,
  switchToSwarmNetwork,
} from "@/lib/blockchain/wallets/swarmEvmNetwork";
import { getSwarmBalance, transferSwarm } from "@/lib/blockchain/token";
import { linkExternalEvmAddress, startGatewayCell } from "@/lib/blockchain/gateway/swarmGatewayCell";
import { swarmIdToEvmAddress } from "@/lib/blockchain/gateway/addressMap";
import {
  MINTME_NETWORK,
  isMintMeChain,
  switchToMintMeNetwork,
} from "@/lib/blockchain/wallets/mintmeNetwork";
import { readMintMeBalance, sendMintMe } from "@/lib/blockchain/wallets/mintmeBridge";

const EXTERNAL_ONLY_CURRENCIES: AppWalletCurrency[] = ["ETH", "BTC"];

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function chainLabel(chainId: string | null): string {
  if (!chainId) return "Unknown chain";
  switch (chainId) {
    case "0x1": return "Ethereum Mainnet";
    case "0xaa36a7": return "Sepolia";
    case "0x89": return "Polygon";
    case SWARM_EVM_CHAIN_ID_HEX: return "Swarm-Space";
    default: return `Chain ${chainId}`;
  }
}

function isEvmAddr(v: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(v.trim());
}

export function BridgePanel() {
  const user = getCurrentUser();
  const [balances, setBalances] = useState(() => (user?.id ? getAppWalletBalances(user.id) : { ETH: 0, BTC: 0, MINTME: 0 }));
  const [swarmBal, setSwarmBal] = useState(0);
  const [swarmDepositAddr, setSwarmDepositAddr] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wdTo, setWdTo] = useState("");
  const [wdAmount, setWdAmount] = useState("");
  const [depAmount, setDepAmount] = useState("");
  const [mmintBal, setMmintBal] = useState<number | null>(null);
  const [mmintTo, setMmintTo] = useState("");
  const [mmintAmount, setMmintAmount] = useState("");

  const available = useMemo(() => isMetaMaskAvailable(), []);

  const refreshMm = useCallback(async () => {
    const [acct, chain] = await Promise.all([getMetaMaskAccount(), getMetaMaskChainId()]);
    setAccount(acct);
    setChainId(chain);
  }, []);

  const refreshSwarm = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [bal, addr] = await Promise.all([
        getSwarmBalance(user.id),
        swarmIdToEvmAddress(user.id),
      ]);
      setSwarmBal(bal);
      setSwarmDepositAddr(addr);
    } catch { /* ignore */ }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    setBalances(getAppWalletBalances(user.id));
    void refreshSwarm();
    const off = onAppWalletUpdate(() => setBalances(getAppWalletBalances(user.id)));
    const onTx = () => { void refreshSwarm(); };
    window.addEventListener("blockchain-transaction", onTx);
    const t = window.setInterval(refreshSwarm, 8000);
    return () => { off(); window.removeEventListener("blockchain-transaction", onTx); window.clearInterval(t); };
  }, [user?.id, refreshSwarm]);

  useEffect(() => {
    if (!available) return;
    void refreshMm();
    return onMetaMaskChange(refreshMm);
  }, [available, refreshMm]);

  useEffect(() => {
    if (account && user?.id) linkExternalEvmAddress(user.id, account);
  }, [account, user?.id]);

  const connect = async () => {
    setBusy(true);
    try {
      const conn = await connectMetaMask();
      if (!conn) {
        toast.error("MetaMask connection was cancelled.");
      } else {
        setAccount(conn.address);
        setChainId(conn.chainId);
        toast.success(`MetaMask connected · ${shortAddr(conn.address)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const externalNotice = (currency: AppWalletCurrency, dir: "deposit" | "withdraw") => {
    toast.info(`${currency} ${dir}s need a bridge signer`, {
      description:
        dir === "deposit"
          ? "P2P mode has no ETH/BTC custodian yet — sale proceeds credit here automatically. MintMe is live below."
          : "ETH/BTC payouts still need a bridge signer. SWARM (above) and MintMe (below) are live via MetaMask.",
    });
  };

  const loadMintMe = useCallback(async () => {
    if (!account) { setMmintBal(null); return; }
    const b = await readMintMeBalance(account);
    setMmintBal(b);
  }, [account]);

  useEffect(() => { if (isMintMeChain(chainId)) void loadMintMe(); }, [chainId, loadMintMe]);

  const sendMintMeNow = async () => {
    if (!account) { toast.error("Connect MetaMask first"); return; }
    const amt = Number(mmintAmount);
    if (!(amt > 0) || !Number.isFinite(amt)) { toast.error("Enter a positive MINTME amount"); return; }
    setBusy(true);
    try {
      const hash = await sendMintMe({ to: mmintTo.trim(), amountEth: amt });
      toast.success("MintMe sent", { description: `tx ${shortAddr(hash)}` });
      setMmintAmount(""); setMmintTo("");
      setTimeout(() => { void loadMintMe(); }, 1500);
    } catch (e) {
      toast.error("Send failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const withdrawSwarm = async () => {
    if (!user?.id) return;
    const amt = Math.floor(Number(wdAmount));
    if (!Number.isFinite(amt) || amt <= 0) { toast.error("Enter a whole SWARM amount"); return; }
    if (amt > swarmBal) { toast.error("Amount exceeds SWARM balance"); return; }
    const to = wdTo.trim();
    if (!isEvmAddr(to)) { toast.error("Enter a valid 0x… address"); return; }
    setBusy(true);
    try {
      if (account && to.toLowerCase() === account.toLowerCase()) {
        linkExternalEvmAddress(user.id, to);
      }
      await transferSwarm({
        from: user.id,
        to,
        amount: amt,
        meta: { via: "bridge-withdraw", evmTo: to.toLowerCase() },
      });
      toast.success(`Sent ${amt} SWARM`, { description: `to ${shortAddr(to)}` });
      setWdAmount(""); setWdTo("");
      await refreshSwarm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  };

  const depositSwarm = async () => {
    if (!user?.id || !account) { toast.error("Connect MetaMask first"); return; }
    const amt = Math.floor(Number(depAmount));
    if (!Number.isFinite(amt) || amt <= 0) { toast.error("Enter a whole SWARM amount"); return; }
    setBusy(true);
    try {
      startGatewayCell();
      if (!isSwarmChain(chainId)) {
        await switchToSwarmNetwork();
      }
      const to = swarmDepositAddr ?? (await swarmIdToEvmAddress(user.id));
      const valueWei = (BigInt(amt) * (10n ** 18n)).toString(16);
      const txHash = await requestMetaMask<string>("eth_sendTransaction", [{
        from: account,
        to,
        value: "0x" + valueWei,
      }]);
      toast.success("Deposit submitted", { description: `tx ${shortAddr(String(txHash))}` });
      setDepAmount("");
      setTimeout(() => { void refreshSwarm(); }, 500);
    } catch (e) {
      toast.error("Deposit failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <WalletIcon className="h-5 w-5 text-primary" /> In-app wallet · Bridge
            </CardTitle>
            <CardDescription>
              SWARM bridging is live via MetaMask on Swarm-Space. ETH / BTC /
              MintMe balances settle from peer sales only.
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            {account ? (
              <>
                <Badge>Connected · {shortAddr(account)}</Badge>
                <span className="text-[10px] text-muted-foreground">{chainLabel(chainId)}</span>
              </>
            ) : (
              <Badge variant="secondary">{available ? "Not connected" : "MetaMask not detected"}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs text-muted-foreground">SWARM balance</div>
              <div className="font-semibold">{swarmBal.toLocaleString()} SWARM</div>
            </div>
            <Badge variant={isSwarmChain(chainId) ? "default" : "secondary"} className="text-[10px]">
              {isSwarmChain(chainId) ? "On Swarm-Space" : "Bridge ready"}
            </Badge>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Withdraw SWARM to any EVM address</Label>
            <Input placeholder="0x… recipient address" value={wdTo} onChange={(e) => setWdTo(e.target.value)} />
            <div className="flex gap-2">
              <Input
                placeholder="Amount (whole SWARM)"
                inputMode="numeric"
                value={wdAmount}
                onChange={(e) => setWdAmount(e.target.value.replace(/[^0-9]/g, ""))}
              />
              <Button type="button" onClick={withdrawSwarm} disabled={busy || !user?.id}>
                <Send className="mr-1 h-3 w-3" /> Send
              </Button>
            </div>
          </div>

          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs">Deposit SWARM from MetaMask</Label>
            <div className="text-[10px] text-muted-foreground break-all">
              Destination: {swarmDepositAddr ?? "…"}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Amount (whole SWARM)"
                inputMode="numeric"
                value={depAmount}
                onChange={(e) => setDepAmount(e.target.value.replace(/[^0-9]/g, ""))}
              />
              <Button type="button" variant="outline" onClick={depositSwarm} disabled={busy || !account}>
                <ArrowDownToLine className="mr-1 h-3 w-3" /> Deposit
              </Button>
            </div>
            {!isSwarmChain(chainId) && account && (
              <div className="text-[10px] text-muted-foreground">
                MetaMask will prompt to switch to Swarm-Space first.
              </div>
            )}
          </div>
        </div>

        {/* MintMe peer bridge — MetaMask signs, no custodian */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground">MintMe peer vault</div>
              <div className="font-semibold">
                {mmintBal == null ? "—" : `${mmintBal.toFixed(6)} MINTME`}
                <span className="ml-2 text-[10px] text-muted-foreground">on-chain (MetaMask)</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                In-app credit: {balances.MINTME.toFixed(6)} MINTME (from peer sales)
              </div>
            </div>
            <div className="flex gap-1">
              {!isMintMeChain(chainId) && account && (
                <Button size="sm" variant="outline" onClick={() => switchToMintMeNetwork().catch(() => {})}>
                  Switch to MintMe
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void loadMintMe()} disabled={!account}>
                Refresh
              </Button>
            </div>
          </div>
          <Label className="text-xs">Send MintMe peer-to-peer (MetaMask signs)</Label>
          <Input placeholder="0x… recipient" value={mmintTo} onChange={(e) => setMmintTo(e.target.value)} />
          <div className="flex gap-2">
            <Input
              placeholder="Amount MINTME"
              inputMode="decimal"
              value={mmintAmount}
              onChange={(e) => setMmintAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            />
            <Button type="button" onClick={sendMintMeNow} disabled={busy || !account}>
              <Send className="mr-1 h-3 w-3" /> Send
            </Button>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Network: {MINTME_NETWORK.chainName} (chain {MINTME_NETWORK.chainId}). No custodian — your MetaMask is the vault.
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {EXTERNAL_ONLY_CURRENCIES.map((c) => (
            <div key={c} className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{c} balance</div>
              <div className="font-semibold">{balances[c].toFixed(6)} {c}</div>
              <div className="mt-2 flex gap-1">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => externalNotice(c, "deposit")}>
                  <ArrowDownToLine className="mr-1 h-3 w-3" /> Deposit
                </Button>
                <Button size="sm" variant="outline" className="flex-1" disabled={balances[c] <= 0} onClick={() => externalNotice(c, "withdraw")}>
                  <ArrowUpFromLine className="mr-1 h-3 w-3" /> Withdraw
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={connect} disabled={!available || busy}>
            <Link2 className="mr-2 h-4 w-4" />
            {account ? "Reconnect MetaMask" : available ? "Connect MetaMask" : "MetaMask not detected"}
          </Button>
          {!available && (
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
              Install MetaMask →
            </a>
          )}
        </div>
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>SWARM + MintMe live · ETH / BTC pending bridge signer</AlertTitle>
          <AlertDescription className="text-xs">
            SWARM moves through the in-browser Swarm gateway cell; MintMe moves
            directly on the MintMe chain — MetaMask signs everything and the
            app never holds your keys. ETH and BTC still need a bridge signer,
            so those balances only reflect peer sales for now.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}