import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowDownToLine, ArrowUpFromLine, Copy, ShieldAlert, Coins, Wallet as WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/lib/auth";
import {
  debitAppWallet,
  getAppWalletBalances,
  onAppWalletUpdate,
  type AppWalletCurrency,
} from "@/lib/blockchain/wallets/appWallet";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import { chainLabel, shortAddr, useMetaMask } from "@/hooks/useMetaMask";
import { MetaMaskConnectButton } from "./MetaMaskConnectButton";

const BRIDGE_CURRENCIES: AppWalletCurrency[] = ["ETH", "BTC", "MINTME"];

export function AssetsTab() {
  const user = getCurrentUser();
  const userId = user?.id ?? "";
  const { balance: creditBalance } = useCreditBalance(userId || null);
  const [swarm, setSwarm] = useState(0);
  const [bridge, setBridge] = useState(() => (userId ? getAppWalletBalances(userId) : { ETH: 0, BTC: 0, MINTME: 0 }));
  const { available, address, chainId } = useMetaMask();

  useEffect(() => {
    if (!userId) return;
    const refresh = async () => {
      setBridge(getAppWalletBalances(userId));
      try { setSwarm(await getSwarmBalance(userId)); } catch { /* ignore */ }
    };
    void refresh();
    const off = onAppWalletUpdate(refresh);
    window.addEventListener("blockchain-transaction", refresh);
    window.addEventListener("credit-transaction", refresh);
    return () => {
      off();
      window.removeEventListener("blockchain-transaction", refresh);
      window.removeEventListener("credit-transaction", refresh);
    };
  }, [userId]);

  const rows = useMemo(() => ([
    { code: "SWARM",  label: "SWARM",  amount: swarm,         kind: "native" as const },
    { code: "CREDIT", label: "Credits", amount: creditBalance, kind: "native" as const },
    { code: "ETH",    label: "ETH — Ethereum", amount: bridge.ETH,    kind: "bridge" as const },
    { code: "BTC",    label: "BTC — Bitcoin",  amount: bridge.BTC,    kind: "bridge" as const },
    { code: "MINTME", label: "MintMe",         amount: bridge.MINTME, kind: "bridge" as const },
  ]), [swarm, creditBalance, bridge]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <WalletIcon className="h-5 w-5 text-primary" /> Assets & Bridge
              </CardTitle>
              <CardDescription>
                Every balance you hold — native SWARM plus bridge currencies that
                come in through market sales. MetaMask is optional and can be
                connected at any time to move bridge funds in or out.
              </CardDescription>
            </div>
            <MetaMaskConnectButton />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {address && (
            <div className="rounded-md border bg-muted/40 p-2 text-xs">
              <span className="text-muted-foreground">MetaMask:</span>{" "}
              <span className="font-mono">{shortAddr(address)}</span>{" "}
              <Badge variant="secondary" className="ml-1 text-[9px]">{chainLabel(chainId)}</Badge>
            </div>
          )}
          <div className="grid gap-2">
            {rows.map((row) => (
              <AssetRow
                key={row.code}
                code={row.code}
                label={row.label}
                amount={row.amount}
                kind={row.kind}
                userId={userId}
                metaMaskAddress={address}
                metaMaskAvailable={available}
              />
            ))}
          </div>
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Bridge signing is landing next release</AlertTitle>
            <AlertDescription className="text-xs">
              Deposits from MetaMask and real on-chain withdrawals go live when
              the bridge signer ships. For now, sale settlements credit your
              bridge balance and manual withdrawals debit locally so the
              accounting stays honest through the update.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

function AssetRow({
  code, label, amount, kind, userId, metaMaskAddress, metaMaskAvailable,
}: {
  code: string;
  label: string;
  amount: number;
  kind: "native" | "bridge";
  userId: string;
  metaMaskAddress: string | null;
  metaMaskAvailable: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-primary" />
          <span className="font-medium">{label}</span>
          {kind === "bridge" && <Badge variant="outline" className="text-[9px]">Bridge</Badge>}
        </div>
        <div className="mt-0.5 text-xl font-semibold tabular-nums">
          {amount.toLocaleString(undefined, { maximumFractionDigits: kind === "bridge" ? 6 : 2 })}{" "}
          <span className="text-xs font-normal text-muted-foreground">{code}</span>
        </div>
      </div>
      {kind === "bridge" && (
        <div className="flex flex-shrink-0 gap-2">
          <DepositDialog code={code as AppWalletCurrency} metaMaskAddress={metaMaskAddress} metaMaskAvailable={metaMaskAvailable} />
          <WithdrawDialog
            code={code as AppWalletCurrency}
            amount={amount}
            userId={userId}
            metaMaskAddress={metaMaskAddress}
          />
        </div>
      )}
    </div>
  );
}

function DepositDialog({
  code, metaMaskAddress, metaMaskAvailable,
}: {
  code: AppWalletCurrency;
  metaMaskAddress: string | null;
  metaMaskAvailable: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowDownToLine className="mr-1 h-3 w-3" /> Deposit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deposit {code}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {!metaMaskAvailable && (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Install MetaMask to bridge {code} into your in-app wallet.
              </AlertDescription>
            </Alert>
          )}
          {metaMaskAvailable && !metaMaskAddress && (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Connect MetaMask first — deposits are matched against the
                connected wallet's outgoing transaction.
              </AlertDescription>
            </Alert>
          )}
          {metaMaskAddress && (
            <div className="space-y-2">
              <Label className="text-xs">Send {code} from</Label>
              <div className="flex items-center gap-2 rounded-md border p-2">
                <span className="flex-1 truncate font-mono text-xs">{metaMaskAddress}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(metaMaskAddress);
                    toast.success("Address copied");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Sale proceeds already land here automatically. External bridge
                deposits go live with the bridge signer release.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => toast.info(`Deposit ${code} — bridge signing coming soon`)}>
            Notify me
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({
  code, amount, userId, metaMaskAddress,
}: {
  code: AppWalletCurrency;
  amount: number;
  userId: string;
  metaMaskAddress: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [dest, setDest] = useState<string>(metaMaskAddress ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (metaMaskAddress) setDest(metaMaskAddress); }, [metaMaskAddress]);

  const parsed = Number(value);
  const invalid = !userId || !(parsed > 0) || parsed > amount || dest.trim().length < 6;

  const submit = async () => {
    if (invalid) return;
    setBusy(true);
    try {
      debitAppWallet(userId, code, parsed);
      toast.success(`Withdraw queued · ${parsed} ${code}`, {
        description: "Debited from in-app ledger. Bridge signer will broadcast when live.",
      });
      setOpen(false);
      setValue("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Withdraw failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={amount <= 0}>
          <ArrowUpFromLine className="mr-1 h-3 w-3" /> Withdraw
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw {code}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Amount</Label>
            <Input
              type="number"
              step="0.000001"
              min="0"
              max={amount}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={amount.toString()}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Available: {amount.toFixed(6)} {code}
            </p>
          </div>
          <div>
            <Label>Destination address</Label>
            <Input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="0x…" />
            <p className="mt-1 text-xs text-muted-foreground">
              {metaMaskAddress ? "Prefilled from connected MetaMask." : "Connect MetaMask to prefill."}
            </p>
          </div>
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription className="text-xs">
              This debits your in-app balance immediately. On-chain broadcast
              runs when the bridge signer ships.
            </AlertDescription>
          </Alert>
        </div>
        <DialogFooter>
          <Button disabled={invalid || busy} onClick={submit}>
            {busy ? "Queuing…" : `Withdraw ${code}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}