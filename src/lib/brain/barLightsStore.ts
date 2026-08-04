/**
 * barLightsStore — dead-simple boolean store for the SurfaceBar's
 * interior lighting.
 *
 * Deliberately outside the 3D scene graph so the toggle button can be a
 * plain DOM button rendered in the page overlay. That means the click
 * cannot be swallowed by a raycast, an invisible collider, an orbit
 * control, or an unmounted BuilderBlock — it is a normal HTML button
 * click, wired straight to React state.
 */
import { useSyncExternalStore } from 'react';

let lightsOn = true;
let updatedAt = 0;
const listeners = new Set<() => void>();

export type BarLightsSnapshot = { on: boolean; updatedAt: number };

/** Outbound gossip hook — fired only for LOCAL changes (never remote applies). */
let gossip: ((snap: BarLightsSnapshot) => void) | null = null;

export function attachBarLightsGossip(fn: (snap: BarLightsSnapshot) => void): void {
  gossip = fn;
}

export function getBarLightsSnapshot(): BarLightsSnapshot {
  return { on: lightsOn, updatedAt };
}

function emit() {
  listeners.forEach((l) => {
    try { l(); } catch { /* ignore */ }
  });
}

export function getBarLightsOn(): boolean {
  return lightsOn;
}

export function setBarLightsOn(next: boolean): void {
  if (lightsOn === next) return;
  lightsOn = next;
  updatedAt = Date.now();
  emit();
  if (gossip) {
    try { gossip(getBarLightsSnapshot()); } catch { /* ignore */ }
  }
}

export function toggleBarLights(): void {
  setBarLightsOn(!lightsOn);
}

/**
 * Apply a peer's light state. Last-writer-wins on `updatedAt`; older or
 * equal stamps are ignored. Never re-broadcasts (no echo loop).
 */
export function acceptPeerBarLights(snap: unknown): boolean {
  const s = snap as Partial<BarLightsSnapshot> | undefined;
  if (!s || typeof s.on !== 'boolean' || typeof s.updatedAt !== 'number') return false;
  if (!Number.isFinite(s.updatedAt) || s.updatedAt <= updatedAt) return false;
  updatedAt = s.updatedAt;
  if (lightsOn === s.on) return false;
  lightsOn = s.on;
  emit();
  return true;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useBarLightsOn(): boolean {
  return useSyncExternalStore(subscribe, getBarLightsOn, getBarLightsOn);
}