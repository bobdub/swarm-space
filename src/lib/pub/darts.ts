/**
 * darts — pure 501 reducer for the pub darts board.
 *
 * No I/O, no React, no mesh. The table host runs this and broadcasts the
 * resulting state; everyone else just renders what they receive.
 */

export interface DartThrow {
  peerId: string;
  /** Final points scored by this dart (already multiplied). */
  points: number;
  /** Human label, e.g. "T20", "BULL", "MISS". */
  label: string;
}

export interface DartsState {
  /** Remaining score per seated peer. 501 down to exactly zero. */
  scores: Record<string, number>;
  /** Score each player had when the current turn started (bust revert). */
  turnStart: Record<string, number>;
  /** Index into the seat order whose turn it is. */
  turnIndex: number;
  /** Darts left in the current turn (3 → 0). */
  throwsLeft: number;
  /** Last few throws, newest first — the scoreboard ticker. */
  recent: DartThrow[];
  winnerPeerId: string | null;
  /** Bumped every applied throw so the UI can animate. */
  rev: number;
}

export const DARTS_START_SCORE = 501;
const MAX_RECENT = 6;

/** Standard clockwise dartboard sector order starting at 20. */
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

export function createDartsState(seatIds: string[]): DartsState {
  const scores: Record<string, number> = {};
  for (const id of seatIds) scores[id] = DARTS_START_SCORE;
  return {
    scores,
    turnStart: { ...scores },
    turnIndex: 0,
    throwsLeft: 3,
    recent: [],
    winnerPeerId: null,
    rev: 0,
  };
}

/** Keep the score map in step with the seat list (join / leave). */
export function syncDartsSeats(state: DartsState, seatIds: string[]): DartsState {
  const scores: Record<string, number> = {};
  const turnStart: Record<string, number> = {};
  for (const id of seatIds) {
    scores[id] = state.scores[id] ?? DARTS_START_SCORE;
    turnStart[id] = state.turnStart[id] ?? scores[id];
  }
  const turnIndex = seatIds.length === 0 ? 0 : state.turnIndex % seatIds.length;
  return { ...state, scores, turnStart, turnIndex };
}

/**
 * Map a release accuracy in [0,1] to a dart result.
 * The panel produces `accuracy` from a timing meter; the reducer owns the
 * scoring table so host and clients can never disagree about a throw.
 */
export function resolveThrow(accuracy: number, roll: number): { points: number; label: string } {
  const a = Math.max(0, Math.min(1, Number.isFinite(accuracy) ? accuracy : 0));
  // Forgiving bands — the meter is hand-timed, so near-centre should pay.
  if (a >= 0.93) return { points: 50, label: 'BULL' };
  if (a >= 0.86) return { points: 25, label: '25' };
  const idx = Math.floor(Math.max(0, Math.min(0.999999, roll)) * SECTORS.length);
  const sector = SECTORS[idx];
  if (a >= 0.74) return { points: sector * 3, label: `T${sector}` };
  if (a >= 0.54) return { points: sector * 2, label: `D${sector}` };
  if (a >= 0.18) return { points: sector, label: `${sector}` };
  return { points: 0, label: 'MISS' };
}

export interface DartsThrowIntent {
  type: 'throw';
  peerId: string;
  accuracy: number;
  /** Deterministic sector pick supplied by the thrower, validated to [0,1). */
  roll: number;
}

export type DartsIntent = DartsThrowIntent | { type: 'reset' };

/**
 * Apply an intent. Returns the same object when the intent is invalid
 * (wrong turn, unknown player, game already won), so callers can skip
 * broadcasting a no-op.
 */
export function applyDartsIntent(
  state: DartsState,
  seatIds: string[],
  intent: DartsIntent,
): DartsState {
  if (intent.type === 'reset') return createDartsState(seatIds);
  if (state.winnerPeerId) return state;
  if (seatIds.length === 0) return state;

  const active = seatIds[state.turnIndex % seatIds.length];
  if (intent.peerId !== active) return state;
  if (!(intent.peerId in state.scores)) return state;

  const { points, label } = resolveThrow(intent.accuracy, intent.roll);
  const before = state.scores[intent.peerId];
  let after = before - points;

  const scores = { ...state.scores };
  const turnStart = { ...state.turnStart };
  let throwsLeft = state.throwsLeft - 1;
  let winnerPeerId: string | null = null;
  let outLabel = label;

  if (after < 0 || after === 1) {
    // Bust — revert to the score this turn started on and hand over.
    after = turnStart[intent.peerId] ?? before;
    outLabel = `${label} BUST`;
    throwsLeft = 0;
  } else if (after === 0) {
    winnerPeerId = intent.peerId;
    throwsLeft = 0;
  }
  scores[intent.peerId] = after;

  let turnIndex = state.turnIndex;
  if (throwsLeft <= 0 && !winnerPeerId) {
    turnIndex = (state.turnIndex + 1) % seatIds.length;
    throwsLeft = 3;
    const next = seatIds[turnIndex];
    turnStart[next] = scores[next] ?? DARTS_START_SCORE;
    turnStart[intent.peerId] = scores[intent.peerId];
  }

  return {
    scores,
    turnStart,
    turnIndex,
    throwsLeft,
    recent: [{ peerId: intent.peerId, points, label: outLabel }, ...state.recent].slice(0, MAX_RECENT),
    winnerPeerId,
    rev: state.rev + 1,
  };
}

/** Seat whose turn it is, or null when the table is empty / finished. */
export function activeDartsSeat(state: DartsState, seatIds: string[]): string | null {
  if (state.winnerPeerId || seatIds.length === 0) return null;
  return seatIds[state.turnIndex % seatIds.length] ?? null;
}
