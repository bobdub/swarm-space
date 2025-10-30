import type { ModeratorDashboardData } from "@/lib/moderation/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const LABELS: Record<keyof ModeratorDashboardData['totals'], { title: string; description: string }> = {
  'content-flag': { title: 'Content Flags', description: 'High-risk submissions in review queue' },
  'post-interval': { title: 'Velocity Blocks', description: 'Fast posting attempts throttled' },
  'post-volume': { title: 'Volume Caps', description: 'Users at 5GB daily quota' },
  'sylabis-limit': { title: 'Sylabis Limits', description: 'Signup bursts halted via tokens' }
};

export const AlertSummaryCards = ({ data }: { data: ModeratorDashboardData }) => {
  const totalAlerts = Object.values(data.totals).reduce((sum, value) => sum + value, 0) || 1;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {(Object.keys(data.totals) as Array<keyof ModeratorDashboardData['totals']>).map(key => {
        const value = data.totals[key];
        const pct = Math.min((value / totalAlerts) * 100, 100);
        const label = LABELS[key];

        return (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">{label.title}</CardTitle>
              <p className="text-xs text-muted-foreground">{label.description}</p>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-bold">{value}</span>
                <span className="text-xs text-muted-foreground">{pct.toFixed(0)}% of total</span>
              </div>
              <Progress value={pct} className="mt-4 h-2" />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
