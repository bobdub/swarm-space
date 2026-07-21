import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Wallet as WalletIcon, ArrowDownToLine, ArrowUpFromLine, ShieldAlert, Link2 } from "lucide-react";
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
} from "@/lib/blockchain/wallets/metaMaskBridge";

const CURRENCIES: AppWalletCurrency[] = ["ETH", "BTC", "MINTME"];

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function chainLabel(chainId: string | null): string {
  if (!chainId) return "Unknown chain";
  switch (chainId) {
    case "0x1":    return "Ethereum Mainnet";
    case "0xaa36a7": return "Sepolia";
    case "0x89":   return "Polygon";
    default:       return `Chain ${chainId}`;
  }
}

export function BridgePanel() {
  const user = getCurrentUser();
  const [balances, setBalances] = useState(() => (user?.id ? getAppWalletBalances(user.id) : { ETH: 0, BTC: 0, MINTME: 0 }));
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = useMemo(() => isMetaMaskAvailable(), []);

  const refreshMm = useCallback(async () => {
    const [acct, chain] = await Promise.all([getMetaMaskAccount(), getMetaMaskChainId()]);
    setAccount(acct);
    setChainId(chain);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    setBalances(getAppWalletBalances(user.id));
    return onAppWalletUpdate(() => setBalances(getAppWalletBalances(user.id)));
  }, [user?.id]);

  useEffect(() => {
    if (!available) return;
    refreshMm();
    return onMetaMaskChange(refreshMm);
  }, [available, refreshMm]);

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

  const deposit = (currency: AppWalletCurrency) => {
    toast.info(`Deposit ${currency} from MetaMask — coming soon`, {
      description: "Bridge signing lands in the next release. Sale proceeds already credit this wallet.",
    });
  };
  const withdraw = (currency: AppWalletCurrency) => {
    toast.info(`Withdraw ${currency} to MetaMask — coming soon`, {
      description: "Bridge signing lands in the next release.",
    });
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
              Sale proceeds settle here. Move funds in and out through MetaMask —
              the app never touches your seed phrase.
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
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          {CURRENCIES.map((c) => (
            <div key={c} className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{c} balance</div>
              <div className="font-semibold">{balances[c].toFixed(6)} {c}</div>
              <div className="mt-2 flex gap-1">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => deposit(c)}>
                  <ArrowDownToLine className="mr-1 h-3 w-3" /> Deposit
                </Button>
                <Button size="sm" variant="outline" className="flex-1" disabled={balances[c] <= 0} onClick={() => withdraw(c)}>
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
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Install MetaMask →
            </a>
          )}
        </div>
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Bridge signing arrives next release</AlertTitle>
          <AlertDescription className="text-xs">
            Today, sale settlements credit your in-app balance and the MetaMask
            connection is read-only. Real deposit/withdraw transfers land as soon
            as bridge signing ships — your balances persist through the update.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}