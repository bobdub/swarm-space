import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as THREE from 'three';

const harness = vi.hoisted(() => ({
  frame: undefined as undefined | ((state: unknown, dt: number) => void),
  portal: vi.fn(() => { throw new Error('DOM portal crossed the Canvas renderer'); }),
  body: { pos: [0, 0, 0] },
  html: vi.fn(),
}));
vi.mock('react-dom', async (original) => ({ ...await original<typeof import('react-dom')>(), createPortal: harness.portal }));
vi.mock('@react-three/fiber', () => ({ useFrame: (callback: typeof harness.frame) => { harness.frame = callback; } }));
vi.mock('@react-three/drei', () => ({
  useGLTF: () => ({ scene: new THREE.Group() }),
  Html: (props: { children: ReactNode }) => { harness.html(props); return <>{props.children}</>; },
}));
vi.mock('@/lib/brain/uqrcPhysics', () => ({ getBrainPhysics: () => ({ getBody: () => harness.body }) }));
vi.mock('@/lib/brain/spaceshipSite', () => ({ shipPadPose: () => ({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] }), shipSiteNormal: () => [0, 1, 0] }));
vi.mock('@/lib/brain/spaceshipStore', () => ({
  useShipsVersion: () => 0, getShips: () => [], padClaim: () => undefined,
  sweepShips: vi.fn(), removeShip: vi.fn(), setLocalShip: vi.fn(), acceptShip: vi.fn(),
}));
vi.mock('@/lib/virtualHub/avatars', () => ({ getAvatarById: () => ({ render: () => null }), loadHubPrefs: () => ({}) }));
vi.mock('@/lib/streaming/webrtcSignalingBridge.standalone', () => ({ getRoomPresences: () => [], onRoomPresenceRemoved: () => vi.fn() }));
vi.mock('@/lib/p2p/swarmMesh.standalone', () => ({ getSwarmMeshStandalone: () => ({ getPeerId: () => 'peer-self', onMessage: () => vi.fn() }) }));
vi.mock('@/lib/brain/spaceshipLaunch', () => ({ chargeShipLaunch: vi.fn(), consumeShipAdmission: vi.fn() }));
vi.mock('@/lib/pub/seating', () => ({ leaveSeat: vi.fn() }));
vi.mock('@/lib/pub/seatLock', () => ({ seatLockFor: () => undefined }));
vi.mock('@/lib/pub/gameTableStore', () => ({ leaveTable: vi.fn() }));

import { SpaceshipLayer, activeLocalShip } from '../SpaceshipLayer';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('spaceship Canvas boundary', () => {
  it('mounts idle without passing a DOM portal to the Canvas or attaching the walker', () => {
    render(<SpaceshipLayer selfId="self" roomId="room" enabled />);
    expect(harness.portal).not.toHaveBeenCalled();
    expect(activeLocalShip('self')).toBeUndefined();
    const overlay = harness.html.mock.calls.map(([props]) => props).find(props => props.fullscreen);
    if (!overlay) throw new Error('Separate DOM boundary missing');
    expect(overlay.calculatePosition(null, null, { width: 360, height: 565 })).toEqual([180, 282.5]);
  });

  it('preserves nearby boarding controls through the separate DOM boundary', () => {
    const { container } = render(<SpaceshipLayer selfId="self" roomId="room" enabled />);
    // RTL supplies DOM refs rather than Three objects; equip only the pad
    // with the spatial API required to exercise proximity in isolation.
    const pad = container.querySelector('group');
    if (!pad) throw new Error('Pad ref missing');
    Object.assign(pad, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
    const frame = harness.frame;
    expect(frame).toBeDefined();
    if (!frame) throw new Error('Spaceship frame callback missing');
    act(() => frame({}, 0.016));
    expect(screen.getByRole('button', { name: 'Launch to Space (5 SWARM)' })).toBeEnabled();
    expect(harness.portal).not.toHaveBeenCalled();
    expect(activeLocalShip('self')).toBeUndefined();
  });
});