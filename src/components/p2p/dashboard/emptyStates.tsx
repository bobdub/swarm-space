import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border/40 bg-muted/10 p-4 text-left">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

export function OfflineEmptyState() {
  return (
    <EmptyState
      title="Mesh offline"
      description="Enable peer-to-peer networking from the networking tab to populate live telemetry."
    />
  );
}

export function NoPeersEmptyState() {
  return (
    <EmptyState
      title="No peers discovered yet"
      description="As rendezvous tickets arrive, connected peers and pending approvals will show up here."
    />
  );
}

export function NoDiagnosticsEmptyState({ action }: { action?: ReactNode }) {
  return (
    <EmptyState
      title="Quiet mesh"
      description="Diagnostics will stream here the moment the networking stack emits new events."
      action={action}
    />
  );
}
