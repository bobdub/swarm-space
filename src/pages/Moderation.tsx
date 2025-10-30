import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCcw, ShieldAlert } from "lucide-react";
import { AlertSummaryCards } from "@/components/moderation/AlertSummaryCards";
import { AlertTable } from "@/components/moderation/AlertTable";
import { fetchModeratorDashboard } from "@/lib/moderation/dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const Moderation = () => {
  const { data, isLoading, isFetching, refetch, isError } = useQuery({
    queryKey: ["moderation-dashboard"],
    queryFn: ({ signal }) => fetchModeratorDashboard(signal),
    staleTime: 60_000
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-16 pt-28">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldAlert className="h-4 w-4 text-secondary" />
            <span>Real-time moderation dashboard</span>
          </div>
          <h1 className="text-2xl font-semibold">Moderator Console</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Inspect Sylabis-triggered rate limits, content scoring flags, and posting throughput to keep the mesh healthy.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data ? (
            <Badge variant="outline" className="text-xs">
              Updated {new Date(data.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Badge>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-60 items-center justify-center rounded-lg border border-dashed">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading moderation feed…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load moderation activity. Please retry or check connectivity.
        </div>
      ) : (
        <>
          <AlertSummaryCards data={data} />

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">High-risk queue</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Content scoring alerts sorted by severity for moderator review.
                </p>
              </CardHeader>
              <CardContent>
                <AlertTable
                  alerts={data.highRiskAlerts}
                  emptyMessage="No high-risk submissions detected in the last hour."
                />
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Recent triggers</CardTitle>
                <p className="text-sm text-muted-foreground">Chronological view of all moderation signals.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.trend.length ? (
                  <ul className="space-y-3 text-sm">
                    {data.trend.slice(-12).map(item => (
                      <li key={`${item.type}-${item.label}`} className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="capitalize">
                            {item.type.replace('-', ' ')}
                          </Badge>
                          <span className="text-muted-foreground">{item.label}</span>
                        </div>
                        <span className="font-medium text-foreground">{item.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No signals recorded for the current window.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">All recent alerts</CardTitle>
              <p className="text-sm text-muted-foreground">
                Combined stream of Sylabis, throughput, and scoring events for auditability.
              </p>
            </CardHeader>
            <CardContent>
              <AlertTable alerts={data.recentAlerts} emptyMessage="No alerts recorded yet." />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default Moderation;
