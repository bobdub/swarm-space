/**
 * PeerJS signaling endpoint list with ordered failover.
 *
 * Every node walks the same ordered list, so when the first server refuses or
 * throttles sockets, nodes converge on the same next server instead of
 * splitting into separate signaling namespaces. Signaling servers do not share
 * peer registries: a fallback only helps peers that fail over to it too.
 *
 * Configure extra servers (e.g. a self-hosted PeerServer) with:
 *   VITE_PEERJS_ENDPOINTS='[{"host":"peer.example.org","port":443,"secure":true,"path":"/"}]'
 * or the single-server shorthand VITE_PEERJS_HOST / _PORT / _SECURE / _PATH.
 * PeerJS Cloud stays in the list as the shared last resort.
 */
export interface SignalingEndpoint {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  path: string;
}

export const PEERJS_CLOUD_ENDPOINT: SignalingEndpoint = {
  id: 'peerjs-cloud',
  label: 'PeerJS Cloud',
  host: '0.peerjs.com',
  port: 443,
  secure: true,
  path: '/',
};

type EnvShape = Record<string, string | boolean | undefined>;

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  if (/^(1|true|yes)$/i.test(value.trim())) return true;
  if (/^(0|false|no)$/i.test(value.trim())) return false;
  return fallback;
}

export function normalizeEndpoint(raw: unknown, index = 0): SignalingEndpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const host = typeof record.host === 'string' ? record.host.trim() : '';
  if (!host || /[\s/]/.test(host)) return null;
  const secure = toBool(record.secure, true);
  const portNum = Number(record.port);
  const port = Number.isInteger(portNum) && portNum > 0 && portNum < 65536 ? portNum : secure ? 443 : 80;
  const pathRaw = typeof record.path === 'string' && record.path.trim() ? record.path.trim() : '/';
  const path = pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`;
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `env-${index}-${host}`;
  const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim() : host;
  return { id, label, host, port, secure, path };
}

/** Configured endpoints first, PeerJS Cloud last; duplicates (same host/port/path) removed. */
export function resolveSignalingEndpoints(env: EnvShape = {}): SignalingEndpoint[] {
  const list: SignalingEndpoint[] = [];
  const rawList = env.VITE_PEERJS_ENDPOINTS;
  if (typeof rawList === 'string' && rawList.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawList);
      (Array.isArray(parsed) ? parsed : [parsed]).forEach((item, i) => {
        const endpoint = normalizeEndpoint(item, i);
        if (endpoint) list.push(endpoint);
      });
    } catch {
      console.warn('[Signaling] Ignoring unparseable VITE_PEERJS_ENDPOINTS');
    }
  }
  if (typeof env.VITE_PEERJS_HOST === 'string' && env.VITE_PEERJS_HOST.trim()) {
    const endpoint = normalizeEndpoint({
      id: 'env-primary',
      host: env.VITE_PEERJS_HOST,
      port: env.VITE_PEERJS_PORT,
      secure: env.VITE_PEERJS_SECURE,
      path: env.VITE_PEERJS_PATH,
      label: env.VITE_PEERJS_LABEL,
    });
    if (endpoint) list.push(endpoint);
  }
  list.push(PEERJS_CLOUD_ENDPOINT);
  const seen = new Set<string>();
  return list.filter(e => {
    const key = `${e.host}:${e.port}${e.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Ordered failover: stay on an endpoint while it works, move to the next one
 * after `failuresBeforeSwitch` consecutive init failures, and wrap around.
 * A successful open resets the failure count but keeps the current endpoint.
 */
export class SignalingEndpointRotation {
  private index = 0;
  private failures = 0;

  constructor(
    private readonly endpoints: SignalingEndpoint[],
    private readonly failuresBeforeSwitch = 2,
  ) {
    if (endpoints.length === 0) throw new Error('At least one signaling endpoint is required');
  }

  current(): SignalingEndpoint { return this.endpoints[this.index]; }

  get size(): number { return this.endpoints.length; }

  /** Returns true when this failure moved to a different endpoint. */
  reportFailure(): boolean {
    this.failures += 1;
    if (this.endpoints.length < 2 || this.failures < this.failuresBeforeSwitch) return false;
    this.failures = 0;
    this.index = (this.index + 1) % this.endpoints.length;
    return true;
  }

  reportSuccess(): void { this.failures = 0; }
}
