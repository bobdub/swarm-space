/**
 * CrossChainSwapPanel — swap coins between blockchains.
 * 1:1 ratio between sub-chains, 2:1 when swapping TO SWARM.
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDownUp, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  getAllLiveChains,
  getChainBalance,
  swapCrossChain,
  type LiveChainInfo,
} from "@/lib/blockchain/multiChainManager";
import { SWAP_RATIO_TO_SWARM } from "@/lib/blockchain/types";

export function CrossChainSwapPanel() {
  const { user } = useAuth();
  const [chains, setChains] = useState<LiveChainInfo[]>([]);
  const [fromChain, setFromChain] = useState<string>("");
  const [toChain, setToChain] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [swapping, setSwapping] = useState(false);
  const [fromBalance, setFromBalance] = useState(0);

  useEffect(() => {
    void loadChains();
  }, []);

  useEffect(() => {
    if (user && fromChain) {
      setFromBalance(getChainBalance(user.id, fromChain));
    }
  }, [user, fromChain]);

  const loadChains = async () => {
    const all = await getAllLiveChains();
    setChains(all);
    if (all.length >= 2) {
      setFromChain(all[0].chainId);
      setToChain(all.length > 1 ? all[1].chainId : all[0].chainId);
    }
  };

  const fromInfo = chains.find((c) => c.chainId === fromChain);
  const toInfo = chains.find((c) => c.chainId === toChain);
  const toSwarm = toChain === "SWARM";
  const ratio = toSwarm ? SWAP_RATIO_TO_SWARM : 1;
  const parsedAmount = parseFloat(amount) || 0;
  const received = parsedAmount / ratio;
  const canSwap =
    fromChain &&
    toChain &&
    fromChain !== toChain &&
    parsedAmount > 0 &&
    parsedAmount <= fromBalance;

  const handleFlip = () => {
    setFromChain(toChain);
    setToChain(fromChain);
    setAmount("");
  };

  const handleSwap = async () => {
    if (!user || !canSwap || !fromInfo || !toInfo) return;
    setSwapping(true);
    try {
      const result = await swapCrossChain({
        userId: user.id,
        fromChainId: fromChain,
        fromTicker: fromInfo.ticker,
        toChainId: toChain,
        toTicker: toInfo.ticker,
        amount: parsedAmount,
      });
      toast.success(
        `Swapped ${result.amountSent} ${fromInfo.ticker} → ${result.amountReceived.toFixed(2)} ${toInfo.ticker}`
      );
      setAmount("");
      // refresh balances
      setFromBalance(getChainBalance(user.id, fromChain));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Swap failed");
    } finally {
      setSwapping(false);
    }
  };

  if (!user || chains.length < 2) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground text-sm">
          Deploy at least one coin to enable cross-chain swapping.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowDownUp className="h-5 w-5 text-primary" />
          Cross-Chain Swap
        </CardTitle>
        <CardDescription>
          Swap coins between blockchains. Sub-chain ↔ sub-chain is 1:1. Swapping to SWARM
          is 2:1.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* From */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">From</Label>
          <div className="flex gap-2">
            <Select value={fromChain} onValueChange={setFromChain}>
              <SelectTrigger className="flex-1 h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {chains.map((c) => (
                  <SelectItem key={c.chainId} value={c.chainId}>
                    {c.ticker} — {c.chainName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder="0.00"
              className="w-28 tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0}
              max={fromBalance}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Balance:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {fromBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>{" "}
            {fromInfo?.ticker}
            {parsedAmount > fromBalance && parsedAmount > 0 && (
              <span className="text-destructive ml-2 inline-flex items-center gap-0.5">
                <AlertTriangle className="h-3 w-3" /> Insufficient
              </span>
            )}
          </p>
        </div>

        {/* Flip */}
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full h-8 w-8 border border-border/40"
            onClick={handleFlip}
          >
            <ArrowDownUp className="h-4 w-4" />
          </Button>
        </div>

        {/* To */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Select value={toChain} onValueChange={setToChain}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chains
                .filter((c) => c.chainId !== fromChain)
                .map((c) => (
                  <SelectItem key={c.chainId} value={c.chainId}>
                    {c.ticker} — {c.chainName}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {parsedAmount > 0 && (
            <div className="rounded-md bg-muted/50 border border-border/40 p-3 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">You receive</span>
              <span className="text-lg font-bold tabular-nums">
                {received.toFixed(2)} {toInfo?.ticker}
              </span>
            </div>
          )}
        </div>

        {/* Ratio info */}
        <div className="flex items-start gap-2 rounded-md bg-muted/30 border border-border/30 p-3 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {toSwarm
              ? `Swapping to SWARM costs 2:1 — you send 2 ${fromInfo?.ticker ?? "coins"} to receive 1 SWARM.`
              : `Sub-chain swaps are 1:1 — ${fromInfo?.ticker ?? "?"} to ${toInfo?.ticker ?? "?"} at equal value.`}
          </span>
        </div>

        <Button
          onClick={handleSwap}
          disabled={!canSwap || swapping}
          className="w-full"
        >
          {swapping
            ? "Swapping..."
            : `Swap ${parsedAmount || 0} ${fromInfo?.ticker ?? ""} → ${received.toFixed(2)} ${toInfo?.ticker ?? ""}`}
        </Button>
      </CardContent>
    </Card>
  );
}
