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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
import { networkToChainOption } from "@/lib/blockchain/walletNetworkPreference";
import type { AssetNetwork } from "@/components/wallet/NetworkActionDialogs";

interface Props {
  onChainChanged?: (ctx: ChainContext) => void;
  network?: string;
  onNetworkChanged?: (network: string) => void;
  /** Recently used wallet networks, most recent first; shown at the top of the picker. */
  recentNetworks?: AssetNetwork[];
}

interface NetworkOption {
  value: string;
  ticker: string;
  chainName?: string;
  isMainChain: boolean;
}

export function ChainSwitcher({ onChainChanged, network, onNetworkChanged, recentNetworks = [] }: Props) {
  const [active, setActive] = useState<ChainContext>(getActiveChain());
  const [chains, setChains] = useState<LiveChainInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadChains();
    const handle = () => setActive(getActiveChain());
    window.addEventListener("active-chain-changed", handle);
    const refresh = () => void loadChains();
    window.addEventListener("coin-deployed", refresh);
    return () => {
      window.removeEventListener("active-chain-changed", handle);
      window.removeEventListener("coin-deployed", refresh);
    };
  }, []);

  const loadChains = async () => {
    const all = await getAllLiveChains();
    setChains(all);
    setLoading(false);
  };

  const handleSwitch = async (chainId: string) => {
    if (chainId === "mintme") {
      onNetworkChanged?.("mintme");
      return;
    }
    if (chainId === "SWARM") {
      switchToMainChain();
    } else {
      await switchToCoin(chainId);
    }
    const updated = getActiveChain();
    setActive(updated);
    onNetworkChanged?.(updated.isMainChain ? "swarm" : `chain:${updated.chainId}`);
    onChainChanged?.(updated);
  };

  if (loading) return null;

  const options: NetworkOption[] = [
    ...(onNetworkChanged ? [{ value: "mintme", ticker: "MintMe", isMainChain: false }] : []),
    ...chains.map((c) => ({ value: c.chainId, ticker: c.ticker, chainName: c.chainName, isMainChain: c.isMainChain })),
  ];
  const byValue = new Map(options.map((o) => [o.value, o]));
  const recentOptions = recentNetworks
    .map((n) => byValue.get(networkToChainOption(n)))
    .filter((o): o is NetworkOption => Boolean(o));
  const recentValues = new Set(recentOptions.map((o) => o.value));
  const otherOptions = options.filter((o) => !recentValues.has(o.value));

  const renderOption = (o: NetworkOption) => (
    <SelectItem key={o.value} value={o.value}>
      {o.value === "mintme" ? (
        "MintMe"
      ) : (
        <span className="flex items-center gap-2">
          {o.isMainChain ? (
            <Globe className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="font-semibold">{o.ticker}</span>
          {o.chainName && (
            <span className="text-muted-foreground text-xs hidden sm:inline">{o.chainName}</span>
          )}
        </span>
      )}
    </SelectItem>
  );

  return (
    <div className="border-y border-border py-2 flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2 text-sm font-medium shrink-0">
        <Zap className="h-4 w-4 text-primary" />
        <span className="text-muted-foreground">Network</span>
      </div>

      <Select value={network === "mintme" ? "mintme" : active.chainId} onValueChange={handleSwitch}>
        <SelectTrigger aria-label="Wallet network" className="flex-1 min-w-0 h-8 text-sm sm:flex-none sm:w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {recentOptions.length > 0 ? (
            <>
              <SelectGroup>
                <SelectLabel className="text-xs text-muted-foreground">Recent</SelectLabel>
                {recentOptions.map(renderOption)}
              </SelectGroup>
              {otherOptions.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel className="text-xs text-muted-foreground">All networks</SelectLabel>
                    {otherOptions.map(renderOption)}
                  </SelectGroup>
                </>
              )}
            </>
          ) : (
            otherOptions.map(renderOption)
          )}
        </SelectContent>
      </Select>

      <Badge
        variant={active.isMainChain ? "default" : "outline"}
        className="text-[10px] px-1.5 py-0 shrink-0"
      >
        {network === "mintme" ? "EVM" : active.isMainChain ? "Main Network" : "Sub-Chain"}
      </Badge>

      {network !== "mintme" && !active.isMainChain && (
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
