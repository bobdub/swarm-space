import { nanoid } from 'nanoid/non-secure';

export type AlertEventLevel = 'info' | 'warning' | 'error';

export interface AlertEvent {
  id: string;
  type: 'miniflare' | 'webhook' | 'system';
  level: AlertEventLevel;
  message: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

type AlertHistoryListener = (events: AlertEvent[]) => void;

const STORAGE_KEY = 'alerts:history:v1';
const MAX_EVENTS = 50;

const listeners = new Set<AlertHistoryListener>();

let historyState: AlertEvent[] = loadHistoryFromStorage();

function loadHistoryFromStorage(): AlertEvent[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        return {
          id: typeof entry.id === 'string' ? entry.id : nanoid(),
          type: entry.type === 'webhook' || entry.type === 'miniflare' ? entry.type : 'system',
          level: entry.level === 'warning' || entry.level === 'error' ? entry.level : 'info',
          message: typeof entry.message === 'string' ? entry.message : 'Unknown event',
          createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
          metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : undefined,
        } as AlertEvent;
      })
      .filter((event): event is NonNullable<typeof event> => {
        if (!event) return false;
        const hasRequired = typeof event.id === 'string' &&
               typeof event.message === 'string' &&
               typeof event.createdAt === 'number';
        return hasRequired;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_EVENTS);
  } catch (error) {
    console.warn('[alerts] Failed to load alert history from storage', error);
    return [];
  }
}

function persistHistory(events: AlertEvent[]): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch (error) {
    console.warn('[alerts] Failed to persist alert history', error);
  }
}

function emit(events: AlertEvent[]): void {
  for (const listener of listeners) {
    try {
      listener(events);
    } catch (error) {
      console.warn('[alerts] Alert history listener threw', error);
    }
  }
}

export function getAlertHistory(): AlertEvent[] {
  return historyState;
}

export function appendAlertEvent(event: Omit<AlertEvent, 'id'> & { id?: string }): AlertEvent {
  const completeEvent: AlertEvent = {
    ...event,
    id: event.id ?? nanoid(),
  };
  historyState = [completeEvent, ...historyState].slice(0, MAX_EVENTS);
  persistHistory(historyState);
  emit(historyState);
  return completeEvent;
}

export function subscribeToAlertHistory(listener: AlertHistoryListener): () => void {
  listeners.add(listener);
  try {
    listener(historyState);
  } catch (error) {
    console.warn('[alerts] Alert history listener threw during subscribe', error);
  }
  return () => {
    listeners.delete(listener);
  };
}
