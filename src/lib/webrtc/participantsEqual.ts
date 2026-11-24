import type { VideoParticipant } from './types';

/**
 * True when two participant lists hold the same people in the same state.
 * `getParticipants()` builds fresh snapshots on every call, and callers
 * refresh on every call event and on a poll; keeping the previous array
 * when nothing changed stops those refreshes from re-rendering the Brain.
 */
export function sameParticipants(a: VideoParticipant[], b: VideoParticipant[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.peerId !== y.peerId || x.username !== y.username || x.stream !== y.stream
      || (x.screenStream ?? null) !== (y.screenStream ?? null) || x.isMuted !== y.isMuted
      || x.isVideoEnabled !== y.isVideoEnabled || x.joinedAt !== y.joinedAt) return false;
  }
  return true;
}
