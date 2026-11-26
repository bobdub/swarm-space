import { describe, expect, it } from 'vitest';
import {
  freshPublicCells,
  mergePublicCellListing,
  parsePublicCellListing,
  publicCellSlot,
  PUBLIC_CELL_STALE_MS,
  type PublicCellListing,
} from '../publicCells';

const NOW = 1_800_000_000_000;
const base = {
  cellId: 'u/alice/ab12',
  name: 'Studio Friends',
  ownerUsername: 'alice',
  ownerUserId: 'uid-alice',
  ownerPeerId: 'peer-builder',
  ownerMeshPeerId: 'peer-alice',
  members: 3,
  announcedAt: NOW - 1_000,
};

describe('public cell registry', () => {
  it('parses a JSON listing and keeps a valid mesh peerId', () => {
    const l = parsePublicCellListing(JSON.stringify(base), NOW);
    expect(l).toMatchObject({ cellId: 'u/alice/ab12', name: 'Studio Friends', members: 3, ownerMeshPeerId: 'peer-alice' });
    expect(l?.withdrawn).toBeUndefined();
  });

  it('rejects bad cell IDs, stale and future listings', () => {
    expect(parsePublicCellListing({ ...base, cellId: 'nope' }, NOW)).toBeNull();
    expect(parsePublicCellListing({ ...base, announcedAt: NOW - PUBLIC_CELL_STALE_MS - 1 }, NOW)).toBeNull();
    expect(parsePublicCellListing({ ...base, announcedAt: NOW + PUBLIC_CELL_STALE_MS + 1 }, NOW)).toBeNull();
    expect(parsePublicCellListing('not json', NOW)).toBeNull();
  });

  it('drops a malformed mesh peerId instead of building a broken link', () => {
    expect(parsePublicCellListing({ ...base, ownerMeshPeerId: 'javascript:alert(1)' }, NOW)?.ownerMeshPeerId).toBe('');
  });

  it('keeps the newest listing and hides withdrawn or stale cells', () => {
    const store = new Map<string, PublicCellListing>();
    expect(mergePublicCellListing(store, parsePublicCellListing(base, NOW)!)).toBe(true);
    expect(mergePublicCellListing(store, { ...base, announcedAt: NOW - 5_000 })).toBe(false);
    expect(freshPublicCells(store, NOW)).toHaveLength(1);
    mergePublicCellListing(store, { ...base, announcedAt: NOW, withdrawn: true });
    expect(freshPublicCells(store, NOW)).toHaveLength(0);
    mergePublicCellListing(store, { ...base, cellId: 'u/bob/cd34', announcedAt: NOW - PUBLIC_CELL_STALE_MS - 10 });
    expect(freshPublicCells(store, NOW)).toHaveLength(0);
  });

  it('orders busier cells first', () => {
    const store = new Map<string, PublicCellListing>();
    mergePublicCellListing(store, { ...base, members: 1 });
    mergePublicCellListing(store, { ...base, cellId: 'u/bob/cd34', members: 9 });
    expect(freshPublicCells(store, NOW).map(l => l.cellId)).toEqual(['u/bob/cd34', 'u/alice/ab12']);
  });

  it('gives each cell its own registry slot', () => {
    expect(publicCellSlot('u/alice/ab12')).toBe('public-cell~u~alice~ab12');
  });
});
