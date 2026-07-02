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
const listeners = new Set<() => void>();

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
  emit();
}

export function toggleBarLights(): void {
  setBarLightsOn(!lightsOn);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useBarLightsOn(): boolean {
  return useSyncExternalStore(subscribe, getBarLightsOn, getBarLightsOn);
}