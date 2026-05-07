import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hammer } from "lucide-react";
import {
  bootLabourLedger,
  subscribeLabourLedger,
  type LabourSnapshot,
} from "@/lib/blockchain/labourLedger";
import { useAuth } from "@/hooks/useAuth";

/**
 * Phase 3 — Labour payouts surfaced from the scaffold bus.
 * Read-only view of every `labour:<actorId>` coin.fill the current
 * device has observed (own + cross-tab).
 */
export function LabourPayoutsPanel() {
  const { user } = useAuth();
  const [snap, setSnap] = useState<LabourSnapshot>({ totals: {}, recent: [], lastUpdate: 0 });

  useEffect(() => {
    void bootLabourLedger();
    const unsub = subscribeLabourLedger(setSnap);
    return () => { unsub(); };
  }, []);

  const sortedActors = Object.entries(snap.totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const myTotal = user ? (snap.totals[user.id] ?? 0) : 0;

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Hammer className="h-4 w-4 text-primary" />
              Labour Payouts
            </CardTitle>
            <CardDescription>
              Cross-scaffolding coin.fill credits from world labour and NPC activity.
            </CardDescription>
          </div>
          {user && (
            <Badge variant="default" className="tabular-nums">
              You: {myTotal.toFixed(3)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {sortedActors.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No labour credits yet. Sculpt, mine or let an NPC work the field.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              {sortedActors.map(([actorId, total]) => (
                <div
                  key={actorId}
                  className="flex items-center justify-between p-2 border rounded-md hover:bg-accent/30"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {actorId === user?.id ? "You" : actorId}
                    </p>
                    <p className="text-[10px] text-muted-foreground">labour:{actorId}</p>
                  </div>
                  <Badge variant="outline" className="tabular-nums shrink-0">
                    {total.toFixed(3)}
                  </Badge>
                </div>
              ))}
            </div>
            {snap.recent.length > 0 && (
              <div>
                <p className="text-xs uppercase text-muted-foreground mb-2">Recent fills</p>
                <ScrollArea className="h-40 pr-3">
                  <div className="space-y-1">
                    {snap.recent.map((entry, idx) => (
                      <div
                        key={`${entry.at}-${idx}`}
                        className="flex items-center justify-between text-xs px-2 py-1 rounded hover:bg-accent/20"
                      >
                        <span className="truncate">
                          {entry.actorId === user?.id ? "You" : entry.actorId}
                          {entry.origin === "peer" && (
                            <span className="ml-1 text-[9px] text-muted-foreground">(peer)</span>
                          )}
                        </span>
                        <span className="tabular-nums text-emerald-500">
                          +{entry.delta.toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}