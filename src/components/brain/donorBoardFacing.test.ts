import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { blockWorldBasis } from '@/lib/brain/blockFrame';
import { DARTS_BOARD_ROLL, DONOR_BOARD_YAW } from './SurfaceBar';

// Wall-hung bar pieces must face the bar's centre. The render frame's local
// +X is the site frame's left, so a piece placed at +rightOffset sits on
// local −X; getting that backwards turns the face into the stone.
function facingIntoRoom(rightOffset: number, localFace: THREE.Vector3, tag: string): number {
  const engine = getBuilderBlockEngine();
  const centre = engine.placeBlock({ id: `${tag}-centre`, kind: 'facing-test', anchorPeerId: 'facing-peer', upOffset: 2 });
  const piece = engine.placeBlock({ id: `${tag}-piece`, kind: 'facing-test', anchorPeerId: 'facing-peer', rightOffset, upOffset: 2 });
  const { worldPos, m } = blockWorldBasis(piece);
  const c = blockWorldBasis(centre).worldPos;
  const face = localFace.clone().applyMatrix4(new THREE.Matrix4().extractRotation(m));
  const toCentre = new THREE.Vector3(c[0] - worldPos[0], c[1] - worldPos[1], c[2] - worldPos[2]).normalize();
  return face.dot(toCentre);
}

describe('bar wall pieces face the room', () => {
  it('donor leaderboard on the east wall shows its face, not its back', () => {
    const face = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, DONOR_BOARD_YAW, 0));
    expect(facingIntoRoom(4.8, face, 'donor')).toBeGreaterThan(0.95);
  });

  it('dartboard on the west wall shows its rings, not its backing', () => {
    const face = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(0, 0, DARTS_BOARD_ROLL));
    expect(facingIntoRoom(-4.8, face, 'darts')).toBeGreaterThan(0.95);
  });
});
