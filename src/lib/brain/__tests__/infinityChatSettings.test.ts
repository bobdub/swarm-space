import { describe, expect, it } from 'vitest';
import { canInfinityReply, canInfinitySpeak, resolveInfinityChatMode, resolveGuestInfinityChatMode, shouldOfferGuestConnection } from '../infinityChatSettings';

describe('Infinity chat participation', () => {
  it('guests default to text replies without speech', () => {
    const mode = resolveGuestInfinityChatMode(undefined);
    expect(mode).toBe('text');
    expect(canInfinityReply(mode)).toBe(true);
    expect(canInfinitySpeak(mode, true)).toBe(false);
  });
  it('retains explicit guest off and audio choices', () => {
    expect(resolveGuestInfinityChatMode('off')).toBe('off');
    expect(resolveGuestInfinityChatMode('audio')).toBe('audio');
  });
  it('offers manual connection only to disconnected guests', () => {
    expect(shouldOfferGuestConnection(true, 0, false)).toBe(true);
    expect(shouldOfferGuestConnection(true, 1, false)).toBe(false);
    expect(shouldOfferGuestConnection(false, 0, false)).toBe(false);
  });
  it('never repeats an offered connection prompt', () => {
    expect(shouldOfferGuestConnection(true, 0, true)).toBe(false);
  });
  it('both toggles off disables replies and speech', () => {
    expect(canInfinityReply('off')).toBe(false);
    expect(canInfinitySpeak('off', true)).toBe(false);
  });
  it('text-only enables replies without speech', () => {
    expect(canInfinityReply('text')).toBe(true);
    expect(canInfinitySpeak('text', true)).toBe(false);
  });
  it('audio mode enables replies and respects voice mute', () => {
    expect(canInfinityReply('audio')).toBe(true);
    expect(canInfinitySpeak('audio', true)).toBe(true);
    expect(canInfinitySpeak('audio', false)).toBe(false);
  });
  it('restores explicit modes and defaults missing or invalid choices to off', () => {
    expect(resolveInfinityChatMode('audio')).toBe('audio');
    expect(resolveInfinityChatMode('text')).toBe('text');
    expect(resolveInfinityChatMode(undefined)).toBe('off');
    expect(resolveInfinityChatMode(true)).toBe('off');
  });
});