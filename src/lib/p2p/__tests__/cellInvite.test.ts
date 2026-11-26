import { describe, expect, it, vi } from 'vitest';

vi.mock('../../auth', () => ({ getCurrentUser: () => null }));

describe('cell invite links', () => {
  it('builds /connect?cell=… with the sharer peer in the hash', async () => {
    const { cellInviteUrl } = await import('../brainInvite');
    expect(cellInviteUrl('https://swarm-space.lovable.app', 'u/alice/ab12', 'peer-alice'))
      .toBe('https://swarm-space.lovable.app/connect?cell=u%2Falice%2Fab12#peer-alice');
    expect(cellInviteUrl('https://x.app', 'u/alice/ab12', null)).toBe('https://x.app/connect?cell=u%2Falice%2Fab12');
    expect(cellInviteUrl('https://x.app', 'u/alice/ab12', 'bogus')).toBe('https://x.app/connect?cell=u%2Falice%2Fab12');
  });

  it('reads the cell from canonical and hash-routed links', async () => {
    const { parseCellInvite, parseBrainInvite } = await import('../brainInvite');
    expect(parseCellInvite('/connect', '#peer-alice', '?cell=u%2Falice%2Fab12')).toBe('u/alice/ab12');
    expect(parseBrainInvite('/connect', '#peer-alice', '?cell=u%2Falice%2Fab12')).toBe('peer-alice');
    expect(parseCellInvite('/', '#/connect?cell=u%2Falice%2Fab12#peer-alice')).toBe('u/alice/ab12');
    expect(parseCellInvite('/connect', '', '?cell=not-a-cell')).toBeNull();
    expect(parseCellInvite('/brain/join', '#peer-alice', '?cell=u%2Falice%2Fab12')).toBeNull();
    expect(parseCellInvite('/explore', '', '?cell=u%2Falice%2Fab12')).toBeNull();
  });

  it('keeps the cell when canonicalizing a hash-routed invite', async () => {
    const { canonicalInviteHref } = await import('../brainInvite');
    expect(canonicalInviteHref('/', '#/connect?cell=u%2Falice%2Fab12#peer-alice'))
      .toBe('/connect?cell=u%2Falice%2Fab12#peer-alice');
  });
});

describe('cell rules', () => {
  it('requires a non-blank cell name', async () => {
    const { normalizeCellName, createUserCell } = await import('../userCell');
    expect(() => normalizeCellName('   ')).toThrow('Cell name is required');
    expect(() => normalizeCellName(undefined)).toThrow('Cell name is required');
    expect(normalizeCellName('  Studio   Friends ')).toBe('Studio Friends');
    expect(normalizeCellName('x'.repeat(80))).toHaveLength(48);
    await expect(createUserCell('')).rejects.toThrow('Cell name is required');
  });

  it('relays only live items made after the cell went public', async () => {
    const { shouldRelayCellItem, LIVE_RELAY_WINDOW_MS } = await import('../userCell');
    const now = 1_800_000_000_000;
    const cell = { isPublic: true, publicSince: now - 60_000 };
    expect(shouldRelayCellItem({ timestamp: now - 1_000 }, cell, now)).toBe(true);
    // Backlog from before going public stays in the cell.
    expect(shouldRelayCellItem({ timestamp: now - 120_000 }, cell, now)).toBe(false);
    // Old catch-up items stay in the cell even after a long public stretch.
    expect(shouldRelayCellItem({ timestamp: now - LIVE_RELAY_WINDOW_MS - 1 }, { isPublic: true, publicSince: 1 }, now)).toBe(false);
    expect(shouldRelayCellItem({ timestamp: now }, { isPublic: false }, now)).toBe(false);
    expect(shouldRelayCellItem({ timestamp: now }, null, now)).toBe(false);
  });

  it('lets content reach the main mesh outside cells only', async () => {
    const { cellAllowsMeshBroadcast } = await import('../userCell');
    localStorage.removeItem('active-user-cell');
    expect(cellAllowsMeshBroadcast()).toBe(true);
  });
});
