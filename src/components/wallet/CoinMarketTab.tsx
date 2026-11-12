import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/auth";
import { getMarketVaultHistory, type VaultTradeReceipt } from "@/lib/blockchain/marketVaultHistory";
import { MarketVaultPanel } from "./MarketVaultPanel";
import { VaultDonationCard } from "./VaultDonationCard";

export function CoinMarketTab() {
  const userId = getCurrentUser()?.id ?? "";
  const [history, setHistory] = useState<VaultTradeReceipt[]>([]);
  const refresh = useCallback(() => {
    if (!userId) { setHistory([]); return; }
    void getMarketVaultHistory(userId).then(setHistory).catch(() => {});
  }, [userId]);
  useEffect(() => {
    refresh();
    const events = ["blockchain-transaction", "reward-pool-update", "creator-vault-update", "swarm-block-mined"];
    events.forEach(event => window.addEventListener(event, refresh));
    return () => events.forEach(event => window.removeEventListener(event, refresh));
  }, [refresh]);
  const purchases = history.filter(trade => trade.direction === "vault-buy");
  const sales = history.filter(trade => trade.direction === "vault-sell");
  return (
    <div className="space-y-6">
      <MarketVaultPanel />
      <Tabs defaultValue="buys" className="space-y-4">
        <TabsList className="grid grid-cols-2 gap-1 h-auto">
          <TabsTrigger value="buys">My purchases ({purchases.length})</TabsTrigger>
          <TabsTrigger value="sales">My sales ({sales.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="buys"><Receipts trades={purchases} empty="You haven’t bought anything yet." /></TabsContent>
        <TabsContent value="sales"><Receipts trades={sales} empty="You haven’t sold anything yet." /></TabsContent>
      </Tabs>
      <VaultDonationCard />
    </div>
  );
}
function Receipts({ trades, empty }: { trades: VaultTradeReceipt[]; empty: string }) {
  if (!trades.length) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  const fmt = (amount: number) => amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return <div className="divide-y">
    {trades.map(trade => <div key={trade.id} className="space-y-2 py-4 text-sm min-w-0">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium break-all">+ {fmt(trade.received)} {trade.receivedAsset}</span>
        <Badge variant="secondary">Recorded</Badge>
      </div>
      <p className="text-muted-foreground break-all">{fmt(trade.paid)} {trade.paidAsset} → {fmt(trade.received)} {trade.receivedAsset}</p>
      <p className="text-xs text-muted-foreground break-all">{fmt(trade.rate)} {trade.paidAsset} / {trade.receivedAsset}</p>
      <p className="text-xs text-muted-foreground">{new Date(trade.timestamp).toLocaleString()}</p>
    </div>)}
  </div>;
}
