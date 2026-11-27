import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { blockWorldBasis } from '@/lib/brain/blockFrame';
import { DARTS_BOARD_ROLL, DONOR_BOARD_YAW, DONOR_RIGHT, STAR_CHART_FORWARD, STAR_CHART_RIGHT, STAR_CHART_YAW, STAR_GRID_HALF } from './SurfaceBar';

// Wall-hung bar pieces must face the bar's centre. The render frame's local
// +X is the site frame's left, so a piece placed at +rightOffset sits on
// local −X; getting that backwards turns the face into the stone.
let n = 0;
/** How squarely a piece at `at` faces the point `target` (both [right, forward] offsets). */
function facing(at: [number, number], target: [number, number], localFace: THREE.Vector3): number {
  const engine = getBuilderBlockEngine();
  const tag = `facing-${n++}`;
  const look = engine.placeBlock({ id: `${tag}-target`, kind: 'facing-test', anchorPeerId: 'facing-peer', rightOffset: target[0], forwardOffset: target[1], upOffset: 2 });
  const piece = engine.placeBlock({ id: `${tag}-piece`, kind: 'facing-test', anchorPeerId: 'facing-peer', rightOffset: at[0], forwardOffset: at[1], upOffset: 2 });
  const { worldPos, m } = blockWorldBasis(piece);
  const c = blockWorldBasis(look).worldPos;
  const face = localFace.clone().applyMatrix4(new THREE.Matrix4().extractRotation(m));
  const toTarget = new THREE.Vector3(c[0] - worldPos[0], c[1] - worldPos[1], c[2] - worldPos[2]).normalize();
  return face.dot(toTarget);
}

describe('bar wall pieces face the room', () => {
  it('donor leaderboard on the back wall faces out into the room', () => {
    const face = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, DONOR_BOARD_YAW, 0));
    // Straight out from the back wall (north, +forward) toward the front.
    expect(facing([DONOR_RIGHT, 9.6], [DONOR_RIGHT, 0], face)).toBeGreaterThan(0.95);
    // And it is in view from the doorway in the middle of the front wall.
    expect(facing([DONOR_RIGHT, 9.6], [0, -9.6], face)).toBeGreaterThan(0.7);
  });

  it('dartboard on the west wall shows its rings, not its backing', () => {
    const face = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(0, 0, DARTS_BOARD_ROLL));
    expect(facing([-4.8, 0], [0, 0], face)).toBeGreaterThan(0.95);
  });

  it('star charts beside the dartboard face into the room', () => {
    const face = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, STAR_CHART_YAW, 0));
    expect(facing([STAR_CHART_RIGHT, STAR_CHART_FORWARD], [0, STAR_CHART_FORWARD], face)).toBeGreaterThan(0.95);
    // Readable from the middle of the room too.
    expect(facing([STAR_CHART_RIGHT, STAR_CHART_FORWARD], [0, 0], face)).toBeGreaterThan(0.7);
  });

  it('star charts hang to the left of the dartboard as you face it, clear of it and the sconce', () => {
    // Facing the west wall from inside, your left is toward the front (−forward).
    const dartsForward = -3;
    const dartsR = 0.34;
    const halfW = STAR_GRID_HALF;
    expect(STAR_CHART_FORWARD + halfW).toBeLessThan(dartsForward - dartsR - 0.3);
    // West wall sconce at forward −5 (2.75 m up) and the front wall at −9.75.
    expect(STAR_CHART_FORWARD + halfW).toBeLessThan(-5.2);
    expect(STAR_CHART_FORWARD - halfW).toBeGreaterThan(-9.75 + 0.5);
  });
});
