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

function LiveRoomVoiceBinding({ roomId, audio }: { roomId: string; audio: boolean }) {
  // Spectator binding: passive join (no mic). Participants will upgrade by
  // calling manager.startLocalStream directly from the dock UI.
  useBrainVoice(true, roomId, { audio });
  return null;
}

export function LiveRoomVoiceHost(): JSX.Element | null {
  const { activeRoomId, roomsById } = useStreaming();
  if (!activeRoomId) return null;
  // Never double-bind the lobby (the /brain route owns that mount).
  if (activeRoomId === BRAIN_ROOM_ID) return null;
  const room = roomsById[activeRoomId];
  if (!room) return null;
  if (room.state === 'ended' || room.broadcast?.state === 'ended' || room.endedAt) return null;
  return <LiveRoomVoiceBinding roomId={activeRoomId} audio={false} />;
}

export default LiveRoomVoiceHost;