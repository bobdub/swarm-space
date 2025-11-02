import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { P2PDiagnosticEvent } from '@/lib/p2p/diagnostics';

interface DiagnosticsDrawerProps {
  events: P2PDiagnosticEvent[];
  trigger?: ReactNode;
}

export function DiagnosticsDrawer({ events, trigger }: DiagnosticsDrawerProps) {
  const recentEvents = events.slice(-25).reverse();

  return (
    <Drawer>
      <DrawerTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            Diagnostics
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="gap-2 text-left">
          <DrawerTitle>Recent diagnostics</DrawerTitle>
          <p className="text-sm text-muted-foreground">
            Showing the last {recentEvents.length} events from the mesh. Visit the debug panel for historical context.
          </p>
        </DrawerHeader>
        <div className="px-4 pb-4">
          <ScrollArea className="max-h-[60vh] rounded-md border border-border/40 bg-background/80">
            <div className="divide-y divide-border/30">
              {recentEvents.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No diagnostics have been emitted yet this session.</p>
              ) : (
                recentEvents.map((event, index) => (
                  <div key={`${event.code}-${event.timestamp}-${index}`} className="flex items-start gap-3 px-4 py-3">
                    <Badge variant={event.level === 'error' ? 'destructive' : event.level === 'warn' ? 'secondary' : 'default'} className="mt-1 text-[11px] uppercase">
                      {event.level}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{event.message}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.timestamp).toLocaleTimeString()} · {event.source} · {event.code}
                      </p>
                      {event.context && (
                        <pre className="mt-2 overflow-x-auto rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
                          {JSON.stringify(event.context, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
          <div className="mt-4 flex justify-end">
            <Button asChild variant="ghost" size="sm">
              <Link to="/settings/networking">Open debug panel</Link>
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
