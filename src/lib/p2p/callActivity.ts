/**
 * Call activity + traffic priority shared between the call stack and the
 * torrent swarm, without either importing the other.
 *
 * Calls and torrents ride separate WebRTC connections but share one
 * internet uplink. While a call is live, torrent traffic rolls downhill:
 * fewer peers, one piece in flight per peer, and pieces only go out when
 * the data channel is not already backed up.
 */

type Probe = () => boolean;
let probe: Probe | null = null;

/** The call stack registers how to tell whether a call is live. */
export function registerCallActivityProbe(fn: Probe | null): void {
  probe = fn;
}

/** True while this device is on an audio/video call with at least one peer. */
export function isCallActive(): boolean {
  try {
    return probe?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Mark every outgoing call track as high priority so the browser (and
 * DSCP-aware networks) favour call audio/video over bulk data.
 */
export async function applyHighMediaPriority(pc: RTCPeerConnection): Promise<void> {
  if (pc.connectionState === "closed" || typeof pc.getSenders !== "function") return;
  let senders: RTCRtpSender[];
  try { senders = pc.getSenders(); } catch { return; }
  for (const sender of senders) {
    if (!sender?.track || typeof sender.getParameters !== "function") continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) continue;
      let changed = false;
      for (const enc of params.encodings as Array<RTCRtpEncodingParameters & { priority?: string; networkPriority?: string }>) {
        if (enc.priority !== "high") { enc.priority = "high"; changed = true; }
        if (enc.networkPriority !== "high") { enc.networkPriority = "high"; changed = true; }
      }
      if (changed) await sender.setParameters(params);
    } catch {
      // Not supported or mid-negotiation; the next stable state retries.
    }
  }
}
