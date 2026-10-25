import { beforeEach, describe, expect, it } from 'vitest';
import { loadHubPrefs, saveHubPrefs } from '../../virtualHub/avatars';

describe('Brain participation persistence', () => {
  beforeEach(() => localStorage.clear());
  it('guest participation does not overwrite member participation', () => {
    saveHubPrefs({ infinityChatMode: 'off', infinityVoice: false });
    saveHubPrefs({ guestInfinityChatMode: 'text' });
    expect(loadHubPrefs().infinityChatMode).toBe('off');
    expect(loadHubPrefs().guestInfinityChatMode).toBe('text');
    expect(loadHubPrefs().infinityVoice).toBe(false);
  });
  it.each(['text', 'audio'] as const)('keeps %s mode through re-entry and device changes', (mode) => {
    saveHubPrefs({ infinityChatMode: mode, infinityVoice: false });
    saveHubPrefs({ avatarId: 'cat', audioInputId: 'microphone' });
    expect(loadHubPrefs().infinityChatMode).toBe(mode);
    expect(loadHubPrefs().infinityVoice).toBe(false);
    expect(loadHubPrefs().avatarId).toBe('cat');
  });
});