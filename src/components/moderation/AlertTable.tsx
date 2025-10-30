import type { AlertRecord } from '../../../services/moderation/types';
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AlertTableProps {
  alerts: AlertRecord[];
  emptyMessage?: string;
}

function resolveBadgeVariant(type: AlertRecord['type']): string {
  switch (type) {
    case 'content-flag':
      return 'destructive';
    case 'post-volume':
      return 'secondary';
    case 'post-interval':
      return 'outline';
    case 'sylabis-limit':
    default:
      return 'default';
  }
}

const SEVERITY_LABEL: Record<AlertRecord['type'], string> = {
  'content-flag': 'Content',
  'post-interval': 'Velocity',
  'post-volume': 'Volume',
  'sylabis-limit': 'Signup'
};

export const AlertTable = ({ alerts, emptyMessage }: AlertTableProps) => {
  if (!alerts.length) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {emptyMessage ?? 'No alerts captured yet.'}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full min-w-[560px] table-fixed">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Summary</th>
            <th className="px-4 py-3">Score</th>
            <th className="px-4 py-3">Actor</th>
            <th className="px-4 py-3">When</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map(alert => (
            <tr key={alert.id} className="border-t text-sm">
              <td className="px-4 py-3">
                <Badge variant={resolveBadgeVariant(alert.type)}>{SEVERITY_LABEL[alert.type]}</Badge>
              </td>
              <td className="truncate px-4 py-3">
                <span className="font-medium text-foreground">{alert.description}</span>
                {alert.metadata?.triggers && Array.isArray(alert.metadata.triggers) ? (
                  <span className="ml-2 text-muted-foreground">
                    {String(alert.metadata.triggers.map((trigger: { description?: string }) => trigger.description).filter(Boolean).join(', '))}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3">
                {alert.score !== undefined ? (
                  <span className={cn('rounded-full px-2 py-1 text-xs font-semibold',
                    alert.score >= 0.8
                      ? 'bg-destructive/10 text-destructive'
                      : alert.score >= 0.6
                        ? 'bg-amber-500/10 text-amber-700'
                        : 'bg-emerald-500/10 text-emerald-700'
                  )}>
                    {alert.score.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-col text-xs">
                  {alert.userId ? <span className="font-semibold">{alert.userId}</span> : <span className="text-muted-foreground">Unknown</span>}
                  {alert.originToken ? <span className="text-muted-foreground">{alert.originToken.slice(0, 10)}…</span> : null}
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {new Date(alert.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
