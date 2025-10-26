import { useCallback, useEffect, useState } from "react";
import { getCreditTransactions } from "@/lib/credits";
import { CreditTransaction } from "@/types";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Coins, ArrowUpRight, ArrowDownRight, Flame, Gift } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface CreditHistoryProps {
  userId: string;
  limit?: number;
}

export function CreditHistory({ userId, limit = 50 }: CreditHistoryProps) {
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const allTxs = await getCreditTransactions(userId);
      setTransactions(allTxs.slice(0, limit));
    } catch (error) {
      console.error("Failed to load transactions:", error);
    } finally {
      setLoading(false);
    }
  }, [limit, userId]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  const getTransactionIcon = (tx: CreditTransaction, isReceiver: boolean) => {
    if (tx.type === "earned_post" || tx.type === "earned_hosting") {
      return <Coins className="h-4 w-4 text-secondary" />;
    }
    if (tx.type === "hype") {
      return isReceiver ? <ArrowDownRight className="h-4 w-4 text-green-500" /> : <Flame className="h-4 w-4 text-orange-500" />;
    }
    if (tx.type === "tip") {
      return isReceiver ? <ArrowDownRight className="h-4 w-4 text-green-500" /> : <Gift className="h-4 w-4 text-primary" />;
    }
    if (tx.type === "transfer") {
      return isReceiver ? <ArrowDownRight className="h-4 w-4 text-green-500" /> : <ArrowUpRight className="h-4 w-4 text-orange-500" />;
    }
    return <Coins className="h-4 w-4 text-primary" />;
  };

  const getTransactionLabel = (tx: CreditTransaction, isReceiver: boolean) => {
    if (tx.type === "earned_post") return "Post Created";
    if (tx.type === "earned_hosting") return "Hosting Reward";
    if (tx.type === "hype") {
      return isReceiver ? `Hype from ${tx.fromUserId.slice(0, 8)}` : "Hyped Post";
    }
    if (tx.type === "tip") {
      return isReceiver ? `Tip from ${tx.fromUserId.slice(0, 8)}` : `Tipped ${tx.toUserId.slice(0, 8)}`;
    }
    if (tx.type === "transfer") {
      return isReceiver ? `Received from ${tx.fromUserId.slice(0, 8)}` : `Sent to ${tx.toUserId.slice(0, 8)}`;
    }
    return tx.type;
  };

  const getDisplayAmount = (tx: CreditTransaction, isReceiver: boolean) => {
    // For received transactions, show positive
    if (isReceiver) return tx.amount;
    // For sent transactions, show negative
    return -tx.amount;
  };

  const getAmountColor = (isReceiver: boolean) => {
    return isReceiver ? "text-green-500" : "text-orange-500";
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </Card>
    );
  }

  if (transactions.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center py-8 text-foreground/60">
          <Coins className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No transactions yet</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Coins className="h-5 w-5" />
        Transaction History
      </h3>
      <ScrollArea className="h-[400px] pr-4">
        <div className="space-y-3">
          {transactions.map((tx) => {
            const isReceiver = tx.toUserId === userId;
            const displayAmount = getDisplayAmount(tx, isReceiver);
            
            return (
              <div
                key={tx.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50 hover:bg-accent/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-background border border-border">
                    {getTransactionIcon(tx, isReceiver)}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{getTransactionLabel(tx, isReceiver)}</p>
                    <p className="text-xs text-foreground/60">
                      {formatDistanceToNow(new Date(tx.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-bold ${getAmountColor(isReceiver)}`}>
                    {displayAmount > 0 ? "+" : ""}
                    {displayAmount}
                  </p>
                  {tx.meta?.burn && (
                    <p className="text-xs text-destructive">
                      🔥 {tx.meta.burn} burned
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}
