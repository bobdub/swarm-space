/**
 * LiveRoomVoiceHost — single app-level mount that binds the WebRTC mesh
 * to the user's currently active live-stream room. Spectators auto-join
 * receive-only (no mic prompt) so they hear/see the room from the feed
 * post; once the user explicitly opts in to participate, mic/camera are
 * acquired by the UI surface (LivePostBoxBody) directly against the
 * WebRTC manager.
 *
 * Audio rendering for every joined room is centralised through
 * <PersistentAudioLayer/> mounted in App.tsx; this component owns only
 * the join lifecycle.
 */
import { useBrainVoice, BRAIN_ROOM_ID } from '@/hooks/useBrainVoice';
import { useLiveRoomBinding } from '@/lib/streaming/spectatedLiveRoomStore';

function LiveRoomVoiceBinding({ roomId, audio }: { roomId: string; audio: boolean }) {
  // Spectator binding: passive join (no mic). Participants will upgrade by
  // calling manager.startLocalStream directly from the dock UI.
  useBrainVoice(true, roomId, { audio });
  return null;
}

export function LiveRoomVoiceHost(): JSX.Element | null {
  const { roomId, audio } = useLiveRoomBinding();
  if (!roomId || roomId === BRAIN_ROOM_ID) return null;
  return <LiveRoomVoiceBinding roomId={roomId} audio={audio} />;
}

export default LiveRoomVoiceHost;