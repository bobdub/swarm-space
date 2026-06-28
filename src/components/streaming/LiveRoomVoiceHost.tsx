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
import { useStreaming } from '@/hooks/useStreaming';
import { useBrainVoice, BRAIN_ROOM_ID } from '@/hooks/useBrainVoice';
import { useSpectatedRoom } from '@/lib/streaming/spectatedLiveRoomStore';

function LiveRoomVoiceBinding({ roomId, audio }: { roomId: string; audio: boolean }) {
  // Spectator binding: passive join (no mic). Participants will upgrade by
  // calling manager.startLocalStream directly from the dock UI.
  useBrainVoice(true, roomId, { audio });
  return null;
}

export function LiveRoomVoiceHost(): JSX.Element | null {
  const { activeRoom } = useStreaming();
  const spectatedRoomId = useSpectatedRoom();
  // Participant join (mic on) wins over passive spectator binding so a
  // popped-out dock doesn't get downgraded by the inline feed preview.
  if (activeRoom && activeRoom.id !== BRAIN_ROOM_ID) {
    const ended = activeRoom.state === 'ended'
      || activeRoom.broadcast?.state === 'ended'
      || activeRoom.endedAt;
    if (!ended) {
      return <LiveRoomVoiceBinding roomId={activeRoom.id} audio />;
    }
  }
  if (spectatedRoomId && spectatedRoomId !== BRAIN_ROOM_ID) {
    return <LiveRoomVoiceBinding roomId={spectatedRoomId} audio={false} />;
  }
  return null;
}

export default LiveRoomVoiceHost;