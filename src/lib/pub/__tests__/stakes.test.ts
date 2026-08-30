import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetPubTables,
  allSeatsAgreed,
  allSeatsFunded,
  getTable,
  joinTable,
  leaveTable,
  markSeatFunded,
  setSeatAgreement,
  setTableStake,
  submitIntent,
  tablePot,
  tableReadyToPlay,
} from '../gameTableStore';
import { escrowAddress } from '../stakes';
import { __resetDrinks, drinkChatLine, recordDrink } from '../drinks';

const T = 'pub:darts:test';

function seatTwo() {
  joinTable({ tableId: T, game: 'darts', peerId: 'a', username: 'A' });
  joinTable({ tableId: T, game: 'darts', peerId: 'b', username: 'B' });
}

describe('pub stakes', () => {
  beforeEach(() => { __resetPubTables(); __resetDrinks(); });

  it('free play is always ready', () => {
    seatTwo();
    expect(tableReadyToPlay(getTable(T))).toBe(true);
  });

  it('a staked table is frozen until everyone agrees and pays', () => {
    seatTwo();
    setTableStake(T, 5);
    expect(tableReadyToPlay(getTable(T))).toBe(false);

    setSeatAgreement(T, 'a', true);
    setSeatAgreement(T, 'b', true);
    expect(allSeatsAgreed(getTable(T))).toBe(true);
    expect(tableReadyToPlay(getTable(T))).toBe(false);

    markSeatFunded(T, 'a');
    markSeatFunded(T, 'b');
    expect(allSeatsFunded(getTable(T))).toBe(true);
    expect(tablePot(getTable(T))).toBe(10);
    expect(tableReadyToPlay(getTable(T))).toBe(true);
  });

  it('changing the stake invalidates agreements', () => {
    seatTwo();
    setTableStake(T, 5);
    setSeatAgreement(T, 'a', true);
    setTableStake(T, 25);
    expect(getTable(T).agreed).toEqual([]);
    expect(getTable(T).funded).toEqual([]);
  });

  it('throws are ignored while the stake is unpaid', () => {
    seatTwo();
    setTableStake(T, 5);
    const before = getTable(T).state.rev;
    submitIntent(T, 'a', { type: 'throw', peerId: 'a', accuracy: 0.95, roll: 0.1 });
    expect(getTable(T).state.rev).toBe(before);
  });

  it('leaving clears agreement and funding', () => {
    seatTwo();
    setTableStake(T, 5);
    setSeatAgreement(T, 'a', true);
    markSeatFunded(T, 'a');
    leaveTable(T, 'a');
    expect(getTable(T).agreed).toEqual([]);
    expect(getTable(T).funded).toEqual([]);
  });

  it('escrow address is deterministic per table', () => {
    expect(escrowAddress(T)).toBe(escrowAddress(T));
    expect(escrowAddress(T)).not.toBe(escrowAddress('other'));
  });
});

describe('drinks', () => {
  beforeEach(() => { __resetDrinks(); });

  it('is idempotent on event id and renders a chat line', () => {
    const evt = {
      id: 'd1', fromPeerId: 'a', fromName: 'Ann',
      toPeerIds: ['b'], round: false, ts: Date.now(),
    };
    expect(recordDrink(evt)).toBe(true);
    expect(recordDrink(evt)).toBe(false);
    expect(drinkChatLine(evt)).toContain('Ann');
    expect(drinkChatLine({ ...evt, round: true })).toContain('round');
  });
});
