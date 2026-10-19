import { describe, expect, it } from 'bun:test';
import { canInfinityReply, canInfinitySpeak, resolveInfinityChatMode } from '../infinityChatSettings';

describe('Infinity chat participation', () => {
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