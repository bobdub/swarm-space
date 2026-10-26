import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const harness = vi.hoisted(() => ({
  frame: undefined as undefined | (() => void),
  sample: vi.fn(),
}));
vi.mock('@react-three/fiber', () => ({ useFrame: (frame: () => void) => { harness.frame = frame; } }));
vi.mock('@react-three/drei', () => ({ Billboard: () => null, Text: () => null }));
vi.mock('@/lib/virtualHub/avatars', () => ({ getAvatarById: () => ({ render: () => null }) }));
vi.mock('@/lib/brain/uqrcPhysics', () => ({ getBrainPhysics: () => ({ getBodyRenderPos: harness.sample }) }));
vi.mock('@/lib/brain/earth', () => ({
  HUMAN_HEIGHT: 1.7,
  getEarthPose: () => ({ center: [100, 0, 0], spinQuat: [0, 0, 0, 1] }),
  getSurfaceFrame: () => ({ up: [0, 1, 0] }),
  worldDisplacementToEarthLocal: (value: number[]) => value,
  quatRotate: (_q: number[], value: number[]) => value,
}));
vi.mock('@/lib/brain/groundHeight', () => ({ feetRadiusAt: () => 1700 }));
vi.mock('@/lib/world/swingFxBus', () => ({ subscribeSwingFx: () => () => {} }));

import { RemoteAvatarBody } from '../RemoteAvatarBody';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mountedAvatar(pinned = false) {
  const { container } = render(<RemoteAvatarBody position={[100, 1701, 20]} trust={0.6} intentDriven localBodyId="self" pinned={pinned} />);
  const group = container.querySelector('group');
  if (!group) throw new Error('Avatar ref missing');
  const spatial = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  Object.assign(group, spatial);
  const frame = harness.frame;
  if (!frame) throw new Error('Frame missing');
  return { spatial, frame };
}

describe('local avatar camera alignment', () => {
  it('uses the live interpolated camera target every frame, not a cached raw position', () => {
    harness.sample.mockReturnValue([100, 1701, 0]);
    const { spatial, frame } = mountedAvatar();
    act(frame);
    expect(spatial.position.toArray()).toEqual([100, 1701, 0]);
    harness.sample.mockReturnValue([110, 1702, 3]);
    act(frame);
    expect(spatial.position.toArray()).toEqual([110, 1702, 3]);
    expect(harness.sample).toHaveBeenCalledWith('self', expect.any(Number), expect.any(Array));
  });

  it('keeps the exact seat transform instead of sampling the standing body', () => {
    const { spatial, frame } = mountedAvatar(true);
    act(frame);
    expect(spatial.position.toArray()).toEqual([100, 1701, 20]);
    expect(harness.sample).not.toHaveBeenCalled();
  });
});