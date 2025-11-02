import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AlertingStatusView, AlertEventView } from '@/hooks/useAlertingStatus';

interface AlertStatusBannerProps {
  view: AlertingStatusView;
}

function getEventTitle(event: AlertEventView): string {
  if (event.type === 'miniflare') {
    return `Miniflare ${event.level === 'error' ? 'failure' : 'suite update'}`;
  }
  if (event.type === 'webhook') {
    return event.level === 'error' ? 'Webhook delivery failed' : 'Webhook delivered';
  }
  return 'System alert';
}

export function AlertStatusBanner({ view }: AlertStatusBannerProps) {
  const { config, automation, recentEvents, isWebhookEnabled, actions } = view;
  const [editOpen, setEditOpen] = useState(false);
  const [draftEndpoint, setDraftEndpoint] = useState(config.endpointUrl);
  const [draftSecret, setDraftSecret] = useState(config.secret ?? '');
  const [draftEnabled, setDraftEnabled] = useState(config.enabled);

  useEffect(() => {
    if (!editOpen) {
      return;
    }
    setDraftEndpoint(config.endpointUrl);
    setDraftSecret(config.secret ?? '');
    setDraftEnabled(config.enabled);
  }, [config, editOpen]);

  const handleOpenChange = (open: boolean) => {
    setEditOpen(open);
    if (!open) {
      setDraftEndpoint(config.endpointUrl);
      setDraftSecret(config.secret ?? '');
      setDraftEnabled(config.enabled);
    }
  };

  const handleSave = () => {
    actions.updateWebhook({
      endpointUrl: draftEndpoint,
      secret: draftSecret || undefined,
      enabled: draftEnabled,
    });
    setEditOpen(false);
  };

  const endpointPreview = useMemo(() => {
    if (!config.endpointUrl) {
      return 'No webhook endpoint configured';
    }
    if (config.endpointUrl.length > 60) {
      return `${config.endpointUrl.slice(0, 57)}…`;
    }
    return config.endpointUrl;
  }, [config.endpointUrl]);

  return (
    <Card className="space-y-4 border-primary/40 bg-primary/5 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Observability automation</h2>
            <p className="text-sm text-muted-foreground">
              Optional: Configure webhooks to receive alerts about swarm health. This is independent of P2P connectivity.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={automation.badgeVariant}>{automation.badgeText}</Badge>
            <Badge variant={isWebhookEnabled ? 'default' : 'outline'}>
              {isWebhookEnabled ? 'Webhook active' : 'Webhook disabled'}
            </Badge>
            {automation.nextRunLabel && (
              <Badge variant="outline">Next run {automation.nextRunLabel}</Badge>
            )}
            {automation.lastRunLabel && (
              <Badge variant="outline">Last run {automation.lastRunLabel}</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3 rounded-md border border-border/40 bg-background/80 px-3 py-2">
            <Switch
              id="webhook-enabled-toggle"
              checked={config.enabled}
              onCheckedChange={(value) => actions.toggleWebhook(Boolean(value))}
              aria-label="Toggle alert webhook"
            />
            <div className="text-sm">
              <p className="font-medium">Webhook {config.enabled ? 'enabled' : 'disabled'}</p>
              <p className="text-xs text-muted-foreground">{endpointPreview}</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            Edit webhook
          </Button>
          <Button onClick={() => actions.triggerAutomation()} disabled={automation.status === 'running'}>
            {automation.status === 'running' ? 'Suite running…' : 'Run suite now'}
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-border/40 bg-background/70 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Recent alert activity</p>
          <span className="text-xs text-muted-foreground">{automation.statusLabel}</span>
        </div>
        {recentEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">Automation has not recorded any alerts yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {recentEvents.map((event) => (
              <li key={event.id} className="flex items-start gap-3 rounded-md border border-border/30 bg-background/60 p-3">
                <Badge variant={event.levelVariant} className="mt-0.5 shrink-0">
                  {event.level.toUpperCase()}
                </Badge>
                <div className="space-y-1">
                  <p className="font-medium leading-tight">{getEventTitle(event)}</p>
                  <p className="leading-tight text-muted-foreground">{event.message}</p>
                  <p className="text-xs text-muted-foreground">{event.timeLabel}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit alert webhook</DialogTitle>
            <DialogDescription>
              Configure where alert payloads should be delivered. Secrets are stored locally in the browser.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="alert-webhook-endpoint">Endpoint URL</Label>
              <Input
                id="alert-webhook-endpoint"
                value={draftEndpoint}
                onChange={(event) => setDraftEndpoint(event.target.value)}
                placeholder="https://example.com/webhook"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="alert-webhook-secret">Shared secret (optional)</Label>
              <Input
                id="alert-webhook-secret"
                type="password"
                value={draftSecret}
                onChange={(event) => setDraftSecret(event.target.value)}
                placeholder="super-secret-token"
              />
              <p className="text-xs text-muted-foreground">Used to sign webhook payloads for verification.</p>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/40 px-3 py-2">
              <div>
                <p className="text-sm font-medium">Enable deliveries</p>
                <p className="text-xs text-muted-foreground">Disable to pause outbound alerts without removing settings.</p>
              </div>
              <Switch
                checked={draftEnabled}
                onCheckedChange={(value) => setDraftEnabled(Boolean(value))}
                aria-label="Enable webhook deliveries"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!draftEndpoint.trim()}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
