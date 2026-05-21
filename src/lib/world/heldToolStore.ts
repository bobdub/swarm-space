/**
 * heldToolStore — tracks which tool prefab the local user currently holds.
 *
 * A held tool is a placement that has been "picked up" out of the world
 * into the player's hand slot. While held it is removed from the engine
 * (no physics body, no world mesh) and surfaced through the HeldToolHUD.
 * Dropping or using it can re-place it via `recordLocalPlacement`.
 *
 * Pure in-memory; nothing persists across reloads — a held tool is
 * ephemeral, so a refresh just leaves the original placement intact
 * because we only mutate the store after pickup commits delete.
 */
import type { PlacementRecord } from '@/lib/world/worldPlacementsStore';

export interface HeldTool {
  prefabId: string;
  /** The original placement record so we can drop it back later. */
  source: PlacementRecord;
}

let held: HeldTool | null = null;
const listeners = new Set<(h: HeldTool | null) => void>();

function notify(): void {
  for (const fn of listeners) {
    try { fn(held); } catch (err) { console.warn('[heldTool] listener error', err); }
  }
}

export function getHeldTool(): HeldTool | null { return held; }

export function setHeldTool(next: HeldTool | null): void {
  held = next;
  notify();
}

export function subscribeHeldTool(fn: (h: HeldTool | null) => void): () => void {
  listeners.add(fn);
  try { fn(held); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}