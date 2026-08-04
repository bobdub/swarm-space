import { describe, it, expect, beforeEach } from 'vitest';
import {
  setBarLightsOn,
  getBarLightsOn,
  acceptPeerBarLights,
  attachBarLightsGossip,
  getBarLightsSnapshot,
} from '@/lib/brain/barLightsStore';

describe('barLightsStore mesh sync', () => {
  beforeEach(() => {
    attachBarLightsGossip(() => {});
    setBarLightsOn(true);
  });

  it('broadcasts local changes', () => {
    const seen: Array<{ on: boolean }> = [];
    attachBarLightsGossip((s) => seen.push(s));
    setBarLightsOn(false);
    expect(seen).toHaveLength(1);
    expect(seen[0].on).toBe(false);
  });

  it('applies a newer remote state', () => {
    setBarLightsOn(true);
    const applied = acceptPeerBarLights({ on: false, updatedAt: Date.now() + 5000 });
    expect(applied).toBe(true);
    expect(getBarLightsOn()).toBe(false);
  });

  it('ignores an older remote state', () => {
    setBarLightsOn(false);
    const local = getBarLightsSnapshot();
    acceptPeerBarLights({ on: true, updatedAt: local.updatedAt - 1000 });
    expect(getBarLightsOn()).toBe(false);
  });

  it('does not re-broadcast remote applies', () => {
    let calls = 0;
    attachBarLightsGossip(() => { calls += 1; });
    acceptPeerBarLights({ on: false, updatedAt: Date.now() + 9000 });
    expect(calls).toBe(0);
  });
});