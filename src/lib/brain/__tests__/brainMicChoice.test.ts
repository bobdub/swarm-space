import { beforeEach, describe, expect, it } from 'vitest';
import {
  completeBrainEntry,
  hasBrainMic,
  isBrainEntryComplete,
  setBrainMic,
} from '../brainMicChoice';

describe('Brain entry mic choice', () => {
  beforeEach(() => localStorage.clear());

  it('is not complete before the gate', () => {
    expect(isBrainEntryComplete()).toBe(false);
    expect(hasBrainMic()).toBe(false);
  });

  it('entering without a mic completes the gate listen-only', () => {
    completeBrainEntry({ avatarId: 'cat', hasMic: false });
    expect(isBrainEntryComplete()).toBe(true);
    expect(hasBrainMic()).toBe(false);
  });

  it('entering with a mic completes the gate with mic on', () => {
    completeBrainEntry({ avatarId: 'cat', audioInputId: 'mic-1', hasMic: true });
    expect(isBrainEntryComplete()).toBe(true);
    expect(hasBrainMic()).toBe(true);
  });

  it('turning the mic on later keeps the entry and avatar', () => {
    completeBrainEntry({ avatarId: 'cat', hasMic: false });
    setBrainMic(true);
    expect(hasBrainMic()).toBe(true);
    expect(isBrainEntryComplete()).toBe(true);
    expect(JSON.parse(localStorage.getItem('brain-entry-complete')!).avatarId).toBe('cat');
  });

  it('keeps old records from before the mic was optional', () => {
    localStorage.setItem('brain-entry-complete', JSON.stringify({ avatarId: 'cat', hasMic: true, ts: 1 }));
    expect(isBrainEntryComplete()).toBe(true);
    expect(hasBrainMic()).toBe(true);
  });
});
