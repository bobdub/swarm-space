/**
 * The shared network chat room.
 *
 * Everyone connected to the mesh talks in this one room, whether they are
 * inside the Brain or chatting from the main menu anywhere else in the app.
 * Being "in" the room only matters for voice and avatars; chat in it is
 * open to every connected peer. Live rooms use their own room ids and stay
 * private to the people inside them.
 */
export const BRAIN_ROOM_ID = 'brain-universe-shared';

/** True for the shared chat every connected peer can read and write. */
export function isNetworkChatRoom(roomId: string | undefined | null): boolean {
  return roomId === BRAIN_ROOM_ID;
}
