/**
 * Call quality: measure each call and steer the listener's playout buffer.
 *
 * The browser encodes, paces and buffers WebRTC audio and video itself, so
 * the app can't re-time individual packets. What it can do is read each
 * call's live numbers (`getStats()`), feed them into the App Health Bus
 * alongside the rest of the mesh, and tune each receiver's playout buffer
 * (`jitterBufferTarget`, where supported): larger on a shaky link so audio
 * doesn't break up, back to the browser default on a clean one so there's
 * no added delay.
 */

export interface CallQuality {
  /** Audio jitter seen at our end, in ms. */
  jitterMs: number | null;
  /** Share of audio packets lost since the last sample, in percent. */
  lossPct: number | null;
  /** Round trip on the selected ICE pair, in ms. */
  rttMs: number | null;
  /** Average time audio spent in the jitter buffer since the last sample, in ms. */
  bufferDelayMs: number | null;
}

export interface CallCounters {
  packetsReceived: number;
  packetsLost: number;
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
}

type StatsEntry = Record<string, unknown> & { type?: string };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Reduce one `getStats()` report to the numbers we care about. `prev` is the
 * previous sample's counters, so loss and buffer delay cover the last
 * interval instead of the whole call.
 */
export function summarizeCallStats(
  report: Iterable<StatsEntry> | { forEach: (cb: (entry: StatsEntry) => void) => void },
  prev: CallCounters | null = null,
): { quality: CallQuality; counters: CallCounters | null } {
  const entries: StatsEntry[] = [];
  if (typeof (report as { forEach?: unknown }).forEach === 'function') {
    (report as { forEach: (cb: (entry: StatsEntry) => void) => void }).forEach((e) => entries.push(e));
  } else {
    for (const e of report as Iterable<StatsEntry>) entries.push(e);
  }

  let jitterMs: number | null = null;
  let counters: CallCounters | null = null;
  let rttMs: number | null = null;
  for (const e of entries) {
    if (e.type === 'inbound-rtp' && (e.kind === 'audio' || e.mediaType === 'audio')) {
      const jitter = num(e.jitter);
      if (jitter !== null) jitterMs = Math.max(jitterMs ?? 0, jitter * 1000);
      counters = {
        packetsReceived: (counters?.packetsReceived ?? 0) + (num(e.packetsReceived) ?? 0),
        packetsLost: (counters?.packetsLost ?? 0) + Math.max(0, num(e.packetsLost) ?? 0),
        jitterBufferDelay: (counters?.jitterBufferDelay ?? 0) + (num(e.jitterBufferDelay) ?? 0),
        jitterBufferEmittedCount: (counters?.jitterBufferEmittedCount ?? 0) + (num(e.jitterBufferEmittedCount) ?? 0),
      };
    }
    if (e.type === 'candidate-pair' && (e.nominated === true || e.selected === true) && e.state === 'succeeded') {
      const rtt = num(e.currentRoundTripTime);
      if (rtt !== null) rttMs = rtt * 1000;
    }
  }

  let lossPct: number | null = null;
  let bufferDelayMs: number | null = null;
  if (counters) {
    const received = counters.packetsReceived - (prev?.packetsReceived ?? 0);
    const lost = counters.packetsLost - (prev?.packetsLost ?? 0);
    if (received + lost > 0) lossPct = Math.max(0, (lost / (received + lost)) * 100);
    const emitted = counters.jitterBufferEmittedCount - (prev?.jitterBufferEmittedCount ?? 0);
    const delay = counters.jitterBufferDelay - (prev?.jitterBufferDelay ?? 0);
    if (emitted > 0) bufferDelayMs = Math.max(0, (delay / emitted) * 1000);
  }
  return { quality: { jitterMs, lossPct, rttMs, bufferDelayMs }, counters };
}

/** Jitter and loss below these mean the browser's own buffer is fine. */
const CLEAN_JITTER_MS = 15;
const CLEAN_LOSS_PCT = 1;
export const MAX_PLAYOUT_TARGET_MS = 300;

/**
 * Playout buffer to ask for, in ms, or null to leave it to the browser.
 * Roughly four times the jitter, plus a cushion when packets are being lost.
 */
export function playoutTargetMs(q: CallQuality): number | null {
  const jitter = q.jitterMs ?? 0;
  const loss = q.lossPct ?? 0;
  if (jitter < CLEAN_JITTER_MS && loss < CLEAN_LOSS_PCT) return null;
  const target = jitter * 4 + (loss >= 5 ? 80 : loss >= CLEAN_LOSS_PCT ? 40 : 0);
  return Math.round(Math.min(MAX_PLAYOUT_TARGET_MS, Math.max(40, target)));
}

/** Health reward for the bus: positive on a clean call, negative on a rough one. */
export function callHealthReward(q: CallQuality): number {
  const jitter = q.jitterMs ?? 0;
  const loss = q.lossPct ?? 0;
  const rtt = q.rttMs ?? 0;
  if (loss >= 10 || jitter >= 100 || rtt >= 800) return -0.4;
  if (loss >= 3 || jitter >= 40 || rtt >= 400) return -0.15;
  return 0.1;
}

export const CALL_QUALITY_INTERVAL_MS = 5_000;

/**
 * Sample every connection on an interval. Returns a stop function.
 * `getConnections` is read on each tick, so peers that join or leave are
 * picked up automatically.
 */
export function startCallQualityMonitor(
  getConnections: () => Map<string, RTCPeerConnection>,
  getRoomId: () => string | null,
  intervalMs: number = CALL_QUALITY_INTERVAL_MS,
): () => void {
  const prevCounters = new Map<string, CallCounters>();
  const lastTarget = new Map<string, number | null>();
  /** Which connection the caches above belong to, per peer. */
  const cachedFor = new Map<string, RTCPeerConnection>();
  let stopped = false;

  const tick = async () => {
    const connections = getConnections();
    for (const id of [...prevCounters.keys()]) if (!connections.has(id)) prevCounters.delete(id);
    for (const id of [...lastTarget.keys()]) if (!connections.has(id)) lastTarget.delete(id);
    for (const id of [...cachedFor.keys()]) if (!connections.has(id)) cachedFor.delete(id);
    for (const [peerId, pc] of connections) {
      if (cachedFor.get(peerId) !== pc) {
        // A reconnect replaced this peer's connection: start its numbers fresh
        // so the new receivers get their own buffer target.
        prevCounters.delete(peerId);
        lastTarget.delete(peerId);
        cachedFor.set(peerId, pc);
      }
      if (stopped || pc.connectionState !== 'connected') continue;
      try {
        const report = await pc.getStats();
        const { quality, counters } = summarizeCallStats(report as unknown as Iterable<StatsEntry>, prevCounters.get(peerId) ?? null);
        if (counters) prevCounters.set(peerId, counters);
        latestQuality.set(peerId, quality);

        const target = playoutTargetMs(quality);
        if (!lastTarget.has(peerId) || lastTarget.get(peerId) !== target) {
          lastTarget.set(peerId, target);
          for (const receiver of pc.getReceivers()) {
            if (receiver.track?.kind !== 'audio' || !('jitterBufferTarget' in receiver)) continue;
            try { (receiver as RTCRtpReceiver & { jitterBufferTarget: number | null }).jitterBufferTarget = target; } catch { /* unsupported value */ }
          }
        }

        const roomId = getRoomId();
        void import('@/lib/uqrc/appHealth')
          .then((m) => m.recordAppEvent('stream', `call:${roomId ?? 'none'}:${peerId.slice(0, 12)}`, { reward: callHealthReward(quality) }))
          .catch(() => { /* health bus unavailable */ });
      } catch { /* connection closed mid-sample */ }
    }
  };

  const timer = setInterval(() => { void tick(); }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    latestQuality.clear();
  };
}

const latestQuality = new Map<string, CallQuality>();

/** Latest measured quality per peer (for diagnostics or a UI badge). */
export function getCallQuality(): Map<string, CallQuality> {
  return new Map(latestQuality);
}
