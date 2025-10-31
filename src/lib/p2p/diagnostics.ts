/**
 * P2P diagnostics event bus
 *
 * Provides a lightweight publish/subscribe mechanism that aggregates
 * notable networking events (initialization attempts, connection
 * timeouts, health warnings, etc).  This allows React hooks and
 * debugging tooling to surface the most recent state without trawling
 * through console logs.
 */

export type P2PDiagnosticLevel = 'info' | 'warn' | 'error';

export type P2PDiagnosticSource =
  | 'peerjs'
  | 'manager'
  | 'chunk-protocol'
  | 'health-monitor'
  | 'useP2P'
  | 'rendezvous'
  | 'bootstrap'
  | 'replication';

export interface P2PDiagnosticEvent {
  id: string;
  level: P2PDiagnosticLevel;
  source: P2PDiagnosticSource;
  code: string;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

export interface P2PDiagnosticsSubscriber {
  (events: P2PDiagnosticEvent[], latest: P2PDiagnosticEvent): void;
}

interface RecordOptions {
  level: P2PDiagnosticLevel;
  source: P2PDiagnosticSource;
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

const MAX_EVENTS = 200;

/**
 * Singleton diagnostics buffer
 */
class P2PDiagnostics {
  private events: P2PDiagnosticEvent[] = [];
  private listeners = new Set<P2PDiagnosticsSubscriber>();
  private sequence = 0;

  record(options: RecordOptions): P2PDiagnosticEvent {
    const event: P2PDiagnosticEvent = {
      id: `${Date.now()}-${this.sequence++}`,
      timestamp: Date.now(),
      ...options,
    };

    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    for (const listener of this.listeners) {
      try {
        listener([...this.events], event);
      } catch (error) {
        console.warn('[P2P][diagnostics] subscriber threw', error);
      }
    }

    return event;
  }

  subscribe(listener: P2PDiagnosticsSubscriber): () => void {
    this.listeners.add(listener);
    const snapshot = [...this.events];
    const latest = snapshot[snapshot.length - 1];
    if (latest) {
      try {
        listener(snapshot, latest);
      } catch (error) {
        console.warn('[P2P][diagnostics] subscriber threw during sync', error);
      }
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  getEvents(): P2PDiagnosticEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
    this.sequence = 0;
  }
}

const diagnostics = new P2PDiagnostics();

export function recordP2PDiagnostic(options: RecordOptions): P2PDiagnosticEvent {
  return diagnostics.record(options);
}

export function getP2PDiagnostics(): P2PDiagnostics {
  return diagnostics;
}

