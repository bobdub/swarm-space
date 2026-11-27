/** Shared boat dimensions (m). y = 0 is the waterline. */
export { BOAT_BEAM, BOAT_LENGTH } from './dockSite';
/** Keel depth below the waterline. */
export const BOAT_DRAFT = 0.6;
/** Deck top above the waterline. */
export const BOAT_DECK_Y = 0.5;
/** Rail height above the deck: waist high, so a stumble or a jump on a
 *  rolling deck never carries anyone over it. */
export const BOAT_RAIL_H = 0.95;
/**
 * The rail holds anyone whose feet are lower than this above the deck. It
 * is above a standing jump (1 m), so nobody hops over the side by
 * accident; the way down into the sea is the stern ladder, or a gate when
 * the boat lies alongside something to step onto.
 */
export const RAIL_HOLD_H = 1.2;
/** Half-length of the side gates in the rail, centred midships. */
export const BOAT_GATE_HALF = 0.55;
