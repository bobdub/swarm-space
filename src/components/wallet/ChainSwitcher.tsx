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
import { Globe, Link2, Users, Zap } from "lucide-react";
import {
  getActiveChain,
  getAllLiveChains,
  switchToMainChain,
  switchToCoin,
  type ChainContext,
  type LiveChainInfo,
} from "@/lib/blockchain/multiChainManager";
import { listWalletCellChains, type WalletCellChain } from "@/lib/blockchain/cellChain/cellWallet";
import { listUserCells, onCellsChange } from "@/lib/p2p/userCell";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  onChainChanged?: (ctx: ChainContext) => void;
  network?: string;
  onNetworkChanged?: (network: string) => void;
}

export function ChainSwitcher({ onChainChanged, network, onNetworkChanged }: Props) {
  const [active, setActive] = useState<ChainContext>(getActiveChain());
  const [chains, setChains] = useState<LiveChainInfo[]>([]);
  const [cellChains, setCellChains] = useState<WalletCellChain[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const userId = user?.id;

  // Cell chains: the creator always sees theirs; members once the cell has two or more.
  useEffect(() => {
    if (!userId) { setCellChains([]); return; }
    let cancelled = false;
    const load = () => {
      void listWalletCellChains(userId, listUserCells().map((c) => c.cellId))
        .then((list) => { if (!cancelled) setCellChains(list); })
        .catch(() => { /* cell chains are optional */ });
    };
    load();
    const unsubscribe = onCellsChange(load);
    const timer = setInterval(load, 15_000);
    return () => { cancelled = true; unsubscribe(); clearInterval(timer); };
  }, [userId]);

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
    if (chainId === "mintme" || chainId === "ethereum" || chainId.startsWith("cell:")) {
      onNetworkChanged?.(chainId);
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

  const isCell = !!network?.startsWith("cell:");
  const isEvm = network === "mintme" || network === "ethereum";
  const selectValue = isEvm || isCell ? network! : active.chainId;

  return (
    <div className="border-y border-border py-2 flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2 text-sm font-medium shrink-0">
        <Zap className="h-4 w-4 text-primary" />
        <span className="text-muted-foreground">Network</span>
      </div>

      <Select value={selectValue} onValueChange={handleSwitch}>
        <SelectTrigger aria-label="Wallet network" className="flex-1 min-w-0 h-8 text-sm sm:flex-none sm:w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {onNetworkChanged && <SelectItem value="mintme">MintMe</SelectItem>}
          {onNetworkChanged && <SelectItem value="ethereum">Ethereum</SelectItem>}
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
          {cellChains.map((c) => (
            <SelectItem key={c.cellId} value={`cell:${c.cellId}`}>
              <span className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-semibold">{c.ticker}</span>
                <span className="text-muted-foreground text-xs hidden sm:inline">{c.name}</span>
              </span>
            </SelectItem>
          ))}
          {isCell && !cellChains.some((c) => `cell:${c.cellId}` === network) && (
            <SelectItem value={network!} disabled>Cell chain</SelectItem>
          )}
        </SelectContent>
      </Select>

      <Badge
        variant={active.isMainChain ? "default" : "outline"}
        className="text-[10px] px-1.5 py-0 shrink-0"
      >
        {isEvm ? "EVM" : isCell ? "Cell Chain" : active.isMainChain ? "Main Network" : "Sub-Chain"}
      </Badge>

      {!isEvm && (isCell || !active.isMainChain) && (
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
