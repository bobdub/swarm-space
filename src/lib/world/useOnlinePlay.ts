import { useSyncExternalStore } from 'react';
import { isOnlinePlay, subscribePlayMode } from './playMode';

/** True while the player is in online play (mesh enabled with a peer link). Re-renders on change. */
export function useOnlinePlay(): boolean {
  return useSyncExternalStore(subscribePlayMode, isOnlinePlay, () => false);
}
