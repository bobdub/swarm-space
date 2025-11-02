import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import type { NodeDashboardSnapshot } from '@/hooks/useNodeDashboard';
import type { P2PControlState } from '@/lib/p2p/manager';
import { SignalingControlModal } from './SignalingControlModal';
import type { SignalingControlAction } from './signalingActions';

const CONTROL_MODAL_ACTION: Partial<Record<keyof P2PControlState, SignalingControlAction>> = {
  paused: 'pause-all',
  pauseInbound: 'pause-inbound',
  pauseOutbound: 'pause-outbound',
};

function formatTimeRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds <= 0) {
    return 'Resuming soon';
  }
  if (totalSeconds < 60) {
    return `Resumes in ${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `Resumes in ${minutes}m${seconds > 0 ? ` ${seconds}s` : ''}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `Resumes in ${hours}h${remainingMinutes > 0 ? ` ${remainingMinutes}m` : ''}`;
}

interface MeshControlsPanelProps {
  snapshot: NodeDashboardSnapshot;
  onToggleMesh: (enabled: boolean) => void;
  onRefreshPeers: () => void;
  onControlChange: (key: keyof P2PControlState, value: boolean, options?: { autoResumeMs?: number }) => void;
}

export function MeshControlsPanel({
  snapshot,
  onToggleMesh,
  onRefreshPeers,
  onControlChange,
}: MeshControlsPanelProps) {
  const { rendezvous, controls, controlResumes } = snapshot;
  const disabledReason = rendezvous.disabledReason;

  const [modalState, setModalState] = useState<{ key: keyof P2PControlState; action: SignalingControlAction } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const resumeTargets = controlResumes ?? {};
  const pausedResumeLabel = resumeTargets.paused ? formatTimeRemaining(resumeTargets.paused - now) : null;
  const inboundResumeLabel = resumeTargets.pauseInbound ? formatTimeRemaining(resumeTargets.pauseInbound - now) : null;
  const outboundResumeLabel = resumeTargets.pauseOutbound ? formatTimeRemaining(resumeTargets.pauseOutbound - now) : null;

  const handleModalConfirm = (options: { autoResumeMs?: number | null }) => {
    if (!modalState) {
      return;
    }
    const resumeMs = options.autoResumeMs ?? undefined;
    if (resumeMs != null) {
      onControlChange(modalState.key, true, { autoResumeMs: resumeMs });
    } else {
      onControlChange(modalState.key, true);
    }
    setModalState(null);
  };

  const handleModalOpenChange = (open: boolean) => {
    if (!open) {
      setModalState(null);
    }
  };

  const handleToggle = (key: keyof P2PControlState, value: boolean) => {
    if (value) {
      const action = CONTROL_MODAL_ACTION[key];
      if (action) {
        setModalState({ key, action });
        return;
      }
    }
    onControlChange(key, value);
  };

  return (
    <>
      <Card className="p-5 space-y-4 border-primary/30 bg-background/60 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Mesh controls</h2>
          <p className="text-sm text-muted-foreground">
            Shape traffic flow, pause rendezvous routing, and trigger peer refreshes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="toggle-mesh"
            checked={rendezvous.enabled}
            onCheckedChange={onToggleMesh}
            aria-label="Toggle rendezvous mesh"
          />
          <label htmlFor="toggle-mesh" className="text-xs text-muted-foreground">
            Rendezvous mesh {rendezvous.enabled ? 'enabled' : 'disabled'}
          </label>
        </div>
      </div>

      {!rendezvous.enabled && (
        <div className="rounded-md border border-border/40 bg-destructive/10 p-3 text-sm text-destructive">
          Mesh routing is offline {disabledReason && `due to ${disabledReason} safeguards`}. Existing peers remain connected.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Auto-connect peers</span>
            <Switch
              checked={controls.autoConnect}
              onCheckedChange={(value) => onControlChange('autoConnect', value)}
              aria-label="Toggle auto-connect"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Manual approval queue</span>
            <Switch
              checked={controls.manualAccept}
              onCheckedChange={(value) => onControlChange('manualAccept', value)}
              aria-label="Toggle manual approval"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Isolate node</span>
            <Switch
              checked={controls.isolate}
              onCheckedChange={(value) => onControlChange('isolate', value)}
              aria-label="Toggle isolation"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-sm font-medium">Pause network</span>
              {pausedResumeLabel && (
                <p className="text-xs text-muted-foreground">{pausedResumeLabel}</p>
              )}
            </div>
            <Switch
              checked={controls.paused}
              onCheckedChange={(value) => handleToggle('paused', value)}
              aria-label="Toggle pause"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-sm font-medium">Pause inbound handshakes</span>
              {inboundResumeLabel && (
                <p className="text-xs text-muted-foreground">{inboundResumeLabel}</p>
              )}
            </div>
            <Switch
              checked={controls.pauseInbound}
              onCheckedChange={(value) => handleToggle('pauseInbound', value)}
              aria-label="Toggle inbound pause"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-sm font-medium">Pause outbound dials</span>
              {outboundResumeLabel && (
                <p className="text-xs text-muted-foreground">{outboundResumeLabel}</p>
              )}
            </div>
            <Switch
              checked={controls.pauseOutbound}
              onCheckedChange={(value) => handleToggle('pauseOutbound', value)}
              aria-label="Toggle outbound pause"
            />
          </div>
        </div>

        <div className="rounded-md border border-border/40 bg-background/70 p-3 space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Mesh health</p>
            <p className="mt-1 text-lg font-semibold">{snapshot.connectionHealth.summary.total} tracked peers</p>
            <p className="text-xs text-muted-foreground">
              {snapshot.connectionHealth.summary.healthy} healthy · {snapshot.connectionHealth.summary.degraded} degraded · {snapshot.connectionHealth.summary.stale} stale
            </p>
            <p className="text-xs text-muted-foreground">
              Packet loss {Math.round(snapshot.connectionHealth.packetLoss * 100)}% · Handshake confidence {Math.round(snapshot.connectionHealth.handshakeConfidence * 100)}%
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRefreshPeers}>
              Refresh peers
            </Button>
            {disabledReason && (
              <Badge variant="destructive" className="text-xs">
                {disabledReason}
              </Badge>
            )}
          </div>
        </div>
      </div>
      </Card>
      <SignalingControlModal
        action={modalState?.action ?? 'pause-all'}
        open={modalState !== null}
        onOpenChange={handleModalOpenChange}
        onConfirm={handleModalConfirm}
      />
    </>
  );
}
