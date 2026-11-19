/**
 * ICE servers shared by the data mesh and the call (voice/video) layer.
 *
 * Both layers must use the same list: when the mesh can only reach a peer
 * through a TURN relay (carrier NAT, strict corporate or university NAT),
 * a STUN-only call connection to that same peer can never complete ICE.
 * The room then shows the peer (presence travels over the mesh) while
 * their audio fails, retries and drops, over and over.
 *
 * `VITE_PEERJS_ICE_SERVERS` (a JSON array of RTCIceServer) replaces the
 * defaults, e.g. to use a private TURN server.
 */
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Public community relays: fallback only, so carrier NAT (mobile) pairs
  // that cannot hole-punch still connect. STUN stays first for direct paths.
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

function fromEnvironment(): RTCIceServer[] | null {
  try {
    const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
    const raw = env.VITE_PEERJS_ICE_SERVERS;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as RTCIceServer[]) : null;
  } catch {
    return null;
  }
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = fromEnvironment() ?? FALLBACK_ICE_SERVERS;
