/**
 * SwarmBridgeDialog — donation-style deposit / withdraw form for SWARM.
 *
 * Flow:
 *  - MetaMask not connected → the button connects first, then opens the form.
 *  - Deposit  : switches MetaMask to Swarm-Space and sends value to the
 *               user's gateway EVM address (swarmIdToEvmAddress).
 *  - Withdraw : moves SWARM on the in-app chain to any 0x… address.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowDownToLine, ArrowUpFromLine, ShieldAlert, Link2 } from "lucide-react";
import { toast } from "sonner";
import { requestMetaMask } from "@/lib/blockchain/wallets/metaMaskBridge";
import {
  isSwarmChain, switchToSwarmNetwork,
} from "@/lib/blockchain/wallets/swarmEvmNetwork";
import { transferSwarm } from "@/lib/blockchain/token";
import { swarmIdToEvmAddress } from "@/lib/blockchain/gateway/addressMap";
import { linkExternalEvmAddress, startGatewayCell } from "@/lib/blockchain/gateway/swarmGatewayCell";
import { shortAddr, chainLabel, useMetaMask } from "@/hooks/useMetaMask";

const PRESETS = [25, 100, 500];

function isEvmAddr(v: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(v.trim());
}

export function SwarmBridgeDialog({
  mode, balance, userId, className,
}: {
  mode: "deposit" | "withdraw";
  balance: number;
  userId: string;
  className?: string;
}) {
  const { available, address, chainId, busy: connecting, connect } = useMetaMask();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"deposit" | "withdraw">(mode);
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState("");
  const [gatewayAddr, setGatewayAddr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setAction(mode); }, [open, mode]);

  useEffect(() => {
    if (!open || !userId) return;
    void swarmIdToEvmAddress(userId).then(setGatewayAddr).catch(() => setGatewayAddr(null));
  }, [open, userId]);

  useEffect(() => {
    if (address && !dest) setDest(address);
    if (address && userId) linkExternalEvmAddress(userId, address);
  }, [address, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = Math.floor(Number(amount));
  const invalid = useMemo(() => {
    if (!userId || !Number.isFinite(parsed) || parsed <= 0) return true;
    if (action === "withdraw") return parsed > balance || !isEvmAddr(dest);
    return !address;
  }, [userId, parsed, action, balance, dest, address]);

  const openForm = async () => {
    if (!address && available) {
      await connect();
    }
    setOpen(true);
  };

  const submit = async () => {
    if (invalid) return;
    setBusy(true);
    try {
      if (action === "withdraw") {
        const to = dest.trim();
        await transferSwarm({
          from: userId,
          to,
          amount: parsed,
          meta: { via: "bridge-withdraw", evmTo: to.toLowerCase() },
        });
        toast.success(`Sent ${parsed} SWARM`, { description: `to ${shortAddr(to)}` });
      } else {
        startGatewayCell();
        if (!isSwarmChain(chainId)) await switchToSwarmNetwork();
        const to = gatewayAddr ?? (await swarmIdToEvmAddress(userId));
        const valueWei = (BigInt(parsed) * 10n ** 18n).toString(16);
        const txHash = await requestMetaMask<string>("eth_sendTransaction", [{
          from: address, to, value: "0x" + valueWei,
        }]);
        toast.success("Deposit submitted", { description: `tx ${shortAddr(String(txHash))}` });
      }
      setAmount("");
      setOpen(false);
      window.dispatchEvent(new Event("blockchain-transaction"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  };

  const Icon = mode === "deposit" ? ArrowDownToLine : ArrowUpFromLine;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        disabled={connecting || (mode === "withdraw" && balance <= 0)}
        onClick={() => void openForm()}
      >
        {!address && available ? <Link2 className="mr-1 h-3 w-3" /> : <Icon className="mr-1 h-3 w-3" />}
        {!address && available ? "Connect" : mode === "deposit" ? "Deposit" : "Withdraw"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move SWARM</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Action toggle */}
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
              {(["deposit", "withdraw"] as const).map((a) => (
                <Button
                  key={a}
                  type="button"
                  size="sm"
                  variant={action === a ? "default" : "ghost"}
                  className="h-8 text-xs capitalize"
                  onClick={() => setAction(a)}
                >
                  {a}
                </Button>
              ))}
            </div>

            {/* Wallet pill */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs">
              <span className="text-muted-foreground">Balance</span>
              <span className="font-semibold tabular-nums">{balance.toLocaleString()} SWARM</span>
              {address ? (
                <Badge variant="secondary" className="text-[9px]">
                  {shortAddr(address)} · {chainLabel(chainId)}
                </Badge>
              ) : (
                <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void connect()}>
                  <Link2 className="mr-1 h-3 w-3" /> Connect MetaMask
                </Button>
              )}
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <Label className="text-xs">Amount (whole SWARM)</Label>
              <Input
                inputMode="numeric"
                value={amount}
                placeholder="0"
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              />
              <div className="flex flex-wrap gap-1">
                {PRESETS.map((p) => (
                  <Button key={p} type="button" size="sm" variant="outline" className="h-7 text-[11px]"
                    onClick={() => setAmount(String(p))}>
                    {p}
                  </Button>
                ))}
                {action === "withdraw" && (
                  <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]"
                    onClick={() => setAmount(String(Math.floor(balance)))}>
                    Max
                  </Button>
                )}
              </div>
            </div>

            {action === "withdraw" ? (
              <div className="space-y-1">
                <Label className="text-xs">Destination address</Label>
                <Input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="0x…" />
                <p className="text-[10px] text-muted-foreground">
                  {address ? "Prefilled from connected MetaMask." : "Any EVM address works."}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">Deposit destination</Label>
                <div className="break-all rounded-md border p-2 font-mono text-[10px]">
                  {gatewayAddr ?? "…"}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  MetaMask will switch to Swarm-Space before signing.
                </p>
              </div>
            )}

            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription className="text-[11px]">
                MetaMask signs every transfer — the app never holds your keys.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button type="button" disabled={invalid || busy} onClick={() => void submit()}>
              {busy ? "Working…" : action === "deposit" ? `Deposit ${parsed > 0 ? parsed : ""} SWARM` : `Withdraw ${parsed > 0 ? parsed : ""} SWARM`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default SwarmBridgeDialog;
