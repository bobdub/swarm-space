/**
 * ChainSwitcher — persistent bar at the top of the wallet showing
 * the active blockchain and letting users switch without disrupting
 * the SWARM mesh connection.
 */

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Globe, Link2, Zap } from "lucide-react";
import {
  getActiveChain,
  getAllLiveChains,
  switchToMainChain,
  switchToCoin,
  type ChainContext,
  type LiveChainInfo,
} from "@/lib/blockchain/multiChainManager";

interface Props {
  onChainChanged?: (ctx: ChainContext) => void;
}

export function ChainSwitcher({ onChainChanged }: Props) {
  const [active, setActive] = useState<ChainContext>(getActiveChain());
  const [chains, setChains] = useState<LiveChainInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadChains();
    const handle = () => setActive(getActiveChain());
    window.addEventListener("active-chain-changed", handle);
    window.addEventListener("coin-deployed", () => void loadChains());
    return () => {
      window.removeEventListener("active-chain-changed", handle);
      window.removeEventListener("coin-deployed", () => void loadChains());
    };
  }, []);

  const loadChains = async () => {
    const all = await getAllLiveChains();
    setChains(all);
    setLoading(false);
  };

  const handleSwitch = async (chainId: string) => {
    if (chainId === "SWARM") {
      switchToMainChain();
    } else {
      await switchToCoin(chainId);
    }
    const updated = getActiveChain();
    setActive(updated);
    onChainChanged?.(updated);
  };

  if (loading) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-card/80 backdrop-blur-sm p-3 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-sm font-medium shrink-0">
        <Zap className="h-4 w-4 text-primary" />
        <span className="text-muted-foreground">Active Chain</span>
      </div>

      <Select value={active.chainId} onValueChange={handleSwitch}>
        <SelectTrigger className="w-auto min-w-[140px] h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {chains.map((c) => (
            <SelectItem key={c.chainId} value={c.chainId}>
              <span className="flex items-center gap-2">
                {c.isMainChain ? (
                  <Globe className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="font-semibold">{c.ticker}</span>
                <span className="text-muted-foreground text-xs hidden sm:inline">
                  {c.chainName}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Badge
        variant={active.isMainChain ? "default" : "outline"}
        className="text-[10px] px-1.5 py-0 shrink-0"
      >
        {active.isMainChain ? "Main Network" : "Sub-Chain"}
      </Badge>

      {!active.isMainChain && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs ml-auto"
          onClick={() => handleSwitch("SWARM")}
        >
          ← Back to SWARM
        </Button>
      )}
    </div>
  );
}
