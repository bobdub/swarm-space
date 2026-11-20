import { describe, it, expect } from 'vitest';
import { getEarthPoseAt, EARTH_RADIUS } from '../earth';
import { encodeSelfPosition, resolvePeerWorldPosition } from '../peerPosition';

describe('peer positions across devices', () => {
  it('lands on the same ground spot even when the clocks differ', () => {
    const senderPose = getEarthPoseAt(1_000_000);
    const ground: [number, number, number] = [
      senderPose.center[0] + EARTH_RADIUS, senderPose.center[1] + 1, senderPose.center[2],
    ];
    const sent = encodeSelfPosition(ground, senderPose);
    // Receiver applies it 5 s later on its own clock.
    const receiverPose = getEarthPoseAt(1_000_005);
    const placed = resolvePeerWorldPosition({ local: sent.local }, receiverPose)!;
    // Same Earth-local point, i.e. same patch of ground.
    const back = encodeSelfPosition(placed, receiverPose).local;
    for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(sent.local[i], 6);
    // The raw world point would have been many metres off.
    const drift = Math.hypot(
      placed[0] - sent.position[0], placed[1] - sent.position[1], placed[2] - sent.position[2],
    );
    expect(drift).toBeGreaterThan(5);
  });

  it('falls back to the world point from older builds', () => {
    expect(resolvePeerWorldPosition({ position: [1, 2, 3] }, getEarthPoseAt(0))).toEqual([1, 2, 3]);
    expect(resolvePeerWorldPosition({}, getEarthPoseAt(0))).toBeNull();
  });
});
