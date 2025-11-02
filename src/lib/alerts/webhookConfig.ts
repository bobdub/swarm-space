export interface AlertWebhookConfig {
  enabled: boolean;
  endpointUrl: string;
  secret?: string;
  lastUpdated: number;
}

type AlertWebhookListener = (config: AlertWebhookConfig) => void;

const STORAGE_KEY = 'alerts:webhook-config:v1';

const listeners = new Set<AlertWebhookListener>();

const defaultConfig: AlertWebhookConfig = {
  enabled: false,
  endpointUrl: '',
  secret: undefined,
  lastUpdated: 0,
};

let configState: AlertWebhookConfig = loadConfigFromStorage();

function loadConfigFromStorage(): AlertWebhookConfig {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return { ...defaultConfig };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...defaultConfig };
    }
    const parsed = JSON.parse(raw) as Partial<AlertWebhookConfig> | null;
    if (!parsed || typeof parsed !== 'object') {
      return { ...defaultConfig };
    }
    return {
      enabled: Boolean(parsed.enabled),
      endpointUrl: typeof parsed.endpointUrl === 'string' ? parsed.endpointUrl : '',
      secret: typeof parsed.secret === 'string' && parsed.secret.length > 0 ? parsed.secret : undefined,
      lastUpdated: typeof parsed.lastUpdated === 'number' ? parsed.lastUpdated : 0,
    };
  } catch (error) {
    console.warn('[alerts] Failed to load webhook config from storage', error);
    return { ...defaultConfig };
  }
}

function persistConfig(next: AlertWebhookConfig): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('[alerts] Failed to persist webhook config', error);
  }
}

function emit(next: AlertWebhookConfig): void {
  for (const listener of listeners) {
    try {
      listener(next);
    } catch (error) {
      console.warn('[alerts] Webhook config listener threw', error);
    }
  }
}

export function getAlertWebhookConfig(): AlertWebhookConfig {
  return configState;
}

export function updateAlertWebhookConfig(update: Partial<AlertWebhookConfig>): AlertWebhookConfig {
  const next: AlertWebhookConfig = {
    ...configState,
    ...update,
    endpointUrl: update.endpointUrl !== undefined ? update.endpointUrl.trim() : configState.endpointUrl,
    secret: update.secret !== undefined ? update.secret || undefined : configState.secret,
    lastUpdated: Date.now(),
  };
  configState = next;
  persistConfig(next);
  emit(next);
  return next;
}

export function subscribeToAlertWebhookConfig(listener: AlertWebhookListener): () => void {
  listeners.add(listener);
  try {
    listener(configState);
  } catch (error) {
    console.warn('[alerts] Webhook config listener threw during subscribe', error);
  }
  return () => {
    listeners.delete(listener);
  };
}
