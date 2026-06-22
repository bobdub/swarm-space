/**
 * Bar interactions — typed registry for the upcoming bar prefab
 * interactions. SCAFFOLD ONLY. All entries are `status: 'planned'`;
 * no runtime wiring exists yet. The intent is to give the bar prefab
 * anchor tags now so future placement code can stamp the tags onto
 * pieces without renaming.
 *
 * Trigger model (future): a single `useNearbyInteractable` hook scans
 * placed pieces tagged with `anchorTag` within INTERACT_RADIUS_M of
 * the player and surfaces the matching `BarInteraction` in the world
 * HUD. Activation is per-anchor; the actual minigame implementation
 * is per-id.
 */

export type BarInteractionId = 'sit' | 'order' | 'darts' | 'pool' | 'jukebox';

export interface BarInteraction {
  id: BarInteractionId;
  /** Short label shown in the proximity HUD. */
  label: string;
  /** Prefab anchor tag the proximity scan looks for. */
  anchorTag: string;
  /** Lifecycle status — gates whether the HUD prompt appears. */
  status: 'planned' | 'beta' | 'shipped';
  /** Activation radius in metres. */
  radiusM: number;
}

/** Default proximity radius for any interaction missing an explicit value. */
export const INTERACT_RADIUS_M = 1.5;

export const BAR_INTERACTIONS: ReadonlyArray<BarInteraction> = [
  { id: 'sit',     label: 'Sit',          anchorTag: 'bar-stool',   status: 'planned', radiusM: 1.0 },
  { id: 'order',   label: 'Order drink',  anchorTag: 'bar-counter', status: 'planned', radiusM: 1.5 },
  { id: 'darts',   label: 'Play darts',   anchorTag: 'darts-board', status: 'planned', radiusM: 1.5 },
  { id: 'pool',    label: 'Play pool',    anchorTag: 'pool-table',  status: 'planned', radiusM: 2.0 },
  { id: 'jukebox', label: 'Pick a song',  anchorTag: 'jukebox',     status: 'planned', radiusM: 1.5 },
];

/** Lookup the registered interaction for a given anchor tag, if any. */
export function findBarInteractionByTag(tag: string): BarInteraction | null {
  return BAR_INTERACTIONS.find((i) => i.anchorTag === tag) ?? null;
}

/** True once any interaction graduates from 'planned'. UI gate. */
export function hasShippedBarInteractions(): boolean {
  return BAR_INTERACTIONS.some((i) => i.status !== 'planned');
}