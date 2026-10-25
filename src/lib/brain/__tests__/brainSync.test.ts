import { describe, it, expect, beforeEach } from 'vitest';
import { syncBrainRoom, clearBrainSync, isBrainSynced, getBrainSyncRoom } from '../brainSyncStore';
import { ROOM_PEER_SILENCE_MS } from '@/lib/streaming/webrtcSignalingBridge.standalone';

describe('Brain sync', () => {
  beforeEach(() => clearBrainSync());

  it('stays synced to the Brain room after leaving the page until Disconnect', () => {
    syncBrainRoom('brain-universe-shared');
    // Page change does nothing to the store; only Disconnect clears it.
    expect(isBrainSynced('brain-universe-shared')).toBe(true);
    clearBrainSync();
    expect(getBrainSyncRoom()).toBeNull();
  });

  it('removes silent peers after about 20 seconds', () => {
    expect(ROOM_PEER_SILENCE_MS).toBe(20_000);
  });
});
