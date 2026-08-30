/**
 * Two-peer seat sync — the automated version of "sit down and check that
 * both of us are on a stool and can see the felt".
 *
 * A host and a joiner claim seats at the same card table. Both viewpoints
 * are then evaluated with the SAME geometry helpers the debug overlay
 * renders: stool height, table visibility, and floor contact.
 */

import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { HUMAN_HEIGHT } from '@/lib/brain/earth';
import {
  registerPubAnchor,
  registerPubSeatAnchor,
  pubSeatWorldPos,
} from '@/lib/world/pubAnchors';
import {
  __resetPubTables,
  getTable,
  joinTable,
  leaveTable,
} from '../gameTableStore';
import { seatIndexOf, seatedTransform, seatLockFor } from '../seatLock';
import {
  baseHeight,
  floorPenetration,
  seesTableTop,
  tableTopHeight,
} from '../seatMetrics';

const TABLE_ID = 'pub:cards:test-bar';
const TABLE_H = 0.9;
const STOOL_H = 0.62;
const SEAT_LIFT = 0.45; // camera lift applied by seatStore.sitDown

beforeAll(() => {
  const engine = getBuilderBlockEngine();
  const table = engine.placeBlock({
    id: 'test:cards-1',
    kind: 'card-table',
    anchorPeerId: 'test',
    rightOffset: 0,
    forwardOffset: 0,
    upOffset: TABLE_H / 2,
    basin: 0.3,
    meta: { height: TABLE_H, radius: 0.85 },
  });
  registerPubAnchor({
    key: table.bodyId,
    tag: 'card-table',
    bodyId: table.bodyId,
    tableId: TABLE_ID,
  });
  for (let i = 0; i < 4; i++) {
    const ang = (Math.PI / 2) * i + Math.PI / 4;
    const stool = engine.placeBlock({
      id: `test:stool-cards-${i}`,
      kind: 'bar-stool',
      anchorPeerId: 'test',
      rightOffset: Math.cos(ang) * 1.6,
      forwardOffset: Math.sin(ang) * 1.6,
      upOffset: STOOL_H / 2,
      basin: 0.45,
      meta: { height: STOOL_H, radius: 0.3 },
    });
    registerPubSeatAnchor({
      tableId: TABLE_ID,
      index: i,
      bodyId: stool.bodyId,
      height: STOOL_H,
    });
  }
});

function seatTwoPeers() {
  joinTable({ tableId: TABLE_ID, game: 'holdem', peerId: 'host', username: 'Host' });
  joinTable({ tableId: TABLE_ID, game: 'holdem', peerId: 'joiner', username: 'Joiner' });
}

describe('two-peer seat sync', () => {
  beforeEach(() => { __resetPubTables(); });

  it('gives host and joiner distinct, deterministic seat indices', () => {
    seatTwoPeers();
    const table = getTable(TABLE_ID, 'holdem');
    const host = seatIndexOf(table, 'host');
    const joiner = seatIndexOf(table, 'joiner');
    expect(host).toBeGreaterThanOrEqual(0);
    expect(joiner).toBeGreaterThanOrEqual(0);
    expect(host).not.toBe(joiner);
    // Both viewpoints resolve the same lock for the same peer.
    expect(seatLockFor('joiner')).toEqual({ tableId: TABLE_ID, peerId: 'joiner', index: joiner });
  });

  it('places every seated peer on a stool, above the floor', () => {
    seatTwoPeers();
    for (const peer of ['host', 'joiner']) {
      const world = seatedTransform(peer);
      expect(world).not.toBeNull();
      const base = baseHeight(world!);
      // Body centre sits above the stool top, not on the ground.
      expect(base).toBeGreaterThan(STOOL_H);
      // ...and the feet never punch through the floor.
      expect(floorPenetration(world!)).toBe(0);
      expect(base).toBeGreaterThanOrEqual(HUMAN_HEIGHT / 2);
    }
  });

  it('lets both viewpoints see the tabletop from above', () => {
    seatTwoPeers();
    const top = tableTopHeight(TABLE_ID);
    expect(top).not.toBeNull();
    for (const peer of ['host', 'joiner']) {
      const world = seatedTransform(peer)!;
      expect(seesTableTop(world, top!, SEAT_LIFT)).toBe(true);
    }
  });

  it('re-resolves seats when a peer stands up, with no ground fallback', () => {
    seatTwoPeers();
    leaveTable(TABLE_ID, 'host');
    expect(seatedTransform('host')).toBeNull();
    const joiner = seatedTransform('joiner');
    expect(joiner).not.toBeNull();
    expect(baseHeight(joiner!)).toBeGreaterThan(STOOL_H);
    // The remaining player is now seat 0 and its stool is registered.
    expect(seatLockFor('joiner')?.index).toBe(0);
    expect(pubSeatWorldPos(TABLE_ID, 0)).not.toBeNull();
  });
});
