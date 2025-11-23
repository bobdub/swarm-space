import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins } from "lucide-react";
import { getUserProfileTokenHoldings, type ProfileTokenHolding } from "@/lib/blockchain/profileTokenBalance";
import { useAuth } from "@/hooks/useAuth";

export function ProfileTokenHoldings() {
  const { user } = useAuth();
  const [holdings, setHoldings] = useState<ProfileTokenHolding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHoldings();
  }, [user]);

  const loadHoldings = async () => {
    if (!user) {
      setHoldings([]);
      setLoading(false);
      return;
    }

    try {
      const data = await getUserProfileTokenHoldings(user.id);
      setHoldings(data);
    } catch (error) {
      console.error("[Holdings] Failed to load:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            Profile Token Holdings
          </CardTitle>
          <CardDescription>Loading your profile token collection...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (holdings.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            Profile Token Holdings
          </CardTitle>
          <CardDescription>You don't own any profile tokens yet</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Hype NFT posts to earn profile tokens from creators!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" />
          Profile Token Holdings
        </CardTitle>
        <CardDescription>Profile tokens you've earned from the community</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {holdings.map((holding) => (
            <div
              key={`${holding.tokenId}-${holding.userId}`}
              className="flex items-center justify-between p-3 rounded-lg border bg-card"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Coins className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">{holding.ticker}</p>
                  <p className="text-xs text-muted-foreground">
                    Creator Token
                  </p>
                </div>
              </div>
              <Badge variant="secondary" className="text-base">
                {holding.amount}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
