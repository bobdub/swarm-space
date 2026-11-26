/**
 * What may cross the Gun relay for a peer whose direct dial stalled, and how
 * to describe the failing ICE candidate pair for diagnosis.
 *
 * Only light, latency-tolerant traffic is relayed: room chat, presence and
 * room membership (the `webrtc-signal` channel, minus call SDP/ICE and media
 * state), profile exchange, new post/comment pushes and goodbye. Torrent chunks already have their
 * own Gun relay, and voice/video stay on WebRTC/TURN only.
 */

export const RELAY_SIGNAL_CHANNEL = 'webrtc-signal';

/** `webrtc-signal` message types allowed over the relay. */
export const RELAYABLE_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  'chat-message',
  'chat-here',
  'chat-history-request',
  'chat-history',
  'presence',
  'room-hello',
  'join-room',
  'leave-room',
  'room-heartbeat',
  'room-sync',
]);

/** Mesh message types (top level) allowed over the relay. */
export const RELAYABLE_MESH_TYPES: ReadonlySet<string> = new Set([
  // Route handshake: proves the peer is really there before we say "Connected (relay)".
  'relay-hello',
  'profile-exchange',
  // New posts and comments are pushed; inventory and request replies look up
  // a direct channel, so they wait for one.
  'content-push',
  'goodbye',
]);

/** Larger messages are not relayed (Gun relays are shared and rate-limited). */
export const RELAY_MAX_MESSAGE_BYTES = 48 * 1024;
/** Presence (avatar movement) is sent at most this often per peer and room. */
export const RELAY_PRESENCE_MIN_GAP_MS = 2_000;

type MeshMessage = { type?: unknown; payload?: unknown };

/** Whether a parsed mesh message may travel over the relay. */
export function isRelayableMessage(msg: MeshMessage | null | undefined): boolean {
  if (!msg || typeof msg.type !== 'string') return false;
  if (msg.type === `channel:${RELAY_SIGNAL_CHANNEL}`) {
    const signal = msg.payload as { msgType?: unknown } | null | undefined;
    return typeof signal?.msgType === 'string' && RELAYABLE_SIGNAL_TYPES.has(signal.msgType);
  }
  return RELAYABLE_MESH_TYPES.has(msg.type);
}

export function fitsRelay(serialized: string): boolean {
  return serialized.length <= RELAY_MAX_MESSAGE_BYTES;
}

/** Drops presence updates that come faster than RELAY_PRESENCE_MIN_GAP_MS. */
export class RelayPresenceThrottle {
  private readonly lastSent = new Map<string, number>();

  constructor(private readonly gapMs = RELAY_PRESENCE_MIN_GAP_MS) {}

  allow(peerId: string, msg: MeshMessage, now: number): boolean {
    if (msg.type !== `channel:${RELAY_SIGNAL_CHANNEL}`) return true;
    const signal = msg.payload as { msgType?: unknown; roomId?: unknown } | null | undefined;
    if (signal?.msgType !== 'presence') return true;
    const key = `${peerId}|${String(signal.roomId ?? '')}`;
    const last = this.lastSent.get(key);
    if (last !== undefined && now - last < this.gapMs) return false;
    this.lastSent.set(key, now);
    return true;
  }

  forget(peerId: string): void {
    for (const key of [...this.lastSent.keys()]) {
      if (key.startsWith(`${peerId}|`)) this.lastSent.delete(key);
    }
  }
}

// ── Candidate pair diagnosis ──────────────────────────────────────────

export interface CandidateSummary {
  type: string;
  protocol: string;
  address: string;
  port: number | null;
  networkType?: string;
}

export interface CandidatePairSummary {
  state: string;
  nominated: boolean;
  local: CandidateSummary | null;
  remote: CandidateSummary | null;
  bytesSent: number;
  bytesReceived: number;
  requestsSent: number;
  responsesReceived: number;
}

export interface StallDiagnosis {
  iceConnectionState: string | null;
  iceGatheringState: string | null;
  pairs: CandidatePairSummary[];
  localTypes: string[];
  remoteTypes: string[];
  /** Plain-language guess at which side or device blocks the path. */
  hint: string;
}

type StatLike = Record<string, unknown> & { id?: string; type?: string };

function candidate(stat: StatLike | undefined): CandidateSummary | null {
  if (!stat) return null;
  return {
    type: String(stat.candidateType ?? 'unknown'),
    protocol: String(stat.protocol ?? 'unknown'),
    address: String(stat.address ?? stat.ip ?? ''),
    port: typeof stat.port === 'number' ? stat.port : null,
    networkType: typeof stat.networkType === 'string' ? stat.networkType : undefined,
  };
}

/** Summarizes an RTCStatsReport (or any iterable of stats) into the pairs that were tried. */
export function summarizeCandidatePairs(
  stats: Iterable<StatLike>,
  states: { iceConnectionState?: string | null; iceGatheringState?: string | null } = {},
): StallDiagnosis {
  const byId = new Map<string, StatLike>();
  const all: StatLike[] = [];
  for (const stat of stats) {
    all.push(stat);
    if (typeof stat.id === 'string') byId.set(stat.id, stat);
  }
  const localTypes = new Set<string>();
  const remoteTypes = new Set<string>();
  for (const stat of all) {
    if (stat.type === 'local-candidate') localTypes.add(String(stat.candidateType ?? 'unknown'));
    if (stat.type === 'remote-candidate') remoteTypes.add(String(stat.candidateType ?? 'unknown'));
  }
  const pairs: CandidatePairSummary[] = all
    .filter(stat => stat.type === 'candidate-pair')
    .map(stat => ({
      state: String(stat.state ?? 'unknown'),
      nominated: stat.nominated === true,
      local: candidate(byId.get(String(stat.localCandidateId))),
      remote: candidate(byId.get(String(stat.remoteCandidateId))),
      bytesSent: Number(stat.bytesSent ?? 0),
      bytesReceived: Number(stat.bytesReceived ?? 0),
      requestsSent: Number(stat.requestsSent ?? 0),
      responsesReceived: Number(stat.responsesReceived ?? 0),
    }));

  return {
    iceConnectionState: states.iceConnectionState ?? null,
    iceGatheringState: states.iceGatheringState ?? null,
    pairs,
    localTypes: [...localTypes],
    remoteTypes: [...remoteTypes],
    hint: diagnoseHint(pairs, localTypes, remoteTypes),
  };
}

function diagnoseHint(pairs: CandidatePairSummary[], local: Set<string>, remote: Set<string>): string {
  if (local.size === 0) return 'no local candidates gathered (this device: ICE blocked or no network)';
  if (remote.size === 0) return 'no remote candidates received (other device or signaling never sent them)';
  if (pairs.length === 0) return 'candidates exchanged but no pairs formed';
  const hostPairs = pairs.filter(p => p.local?.type === 'host' && p.remote?.type === 'host');
  const mdnsRemote = pairs.some(p => p.remote?.address.endsWith('.local'));
  if (hostPairs.length > 0 && hostPairs.every(p => p.responsesReceived === 0)) {
    return mdnsRemote
      ? 'host-to-host checks unanswered and remote uses mDNS (.local) names: router may block mDNS or isolate clients'
      : 'host-to-host checks unanswered: router likely isolates Wi-Fi clients (AP/client isolation)';
  }
  const srflxPairs = pairs.filter(p => p.local?.type === 'srflx' || p.remote?.type === 'srflx');
  if (hostPairs.length === 0 && srflxPairs.length > 0 && srflxPairs.every(p => p.responsesReceived === 0)) {
    return 'only public (srflx) pairs tried and unanswered: router lacks NAT hairpinning';
  }
  if (!local.has('relay') && !remote.has('relay')) return 'no TURN relay candidates on either side';
  return 'pairs tried but none succeeded';
}
