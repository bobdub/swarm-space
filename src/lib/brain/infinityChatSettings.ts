export type InfinityChatMode = 'off' | 'audio' | 'text';

/** Participation is opt-in; a legacy voice preference alone is not consent. */
export function resolveInfinityChatMode(value: unknown): InfinityChatMode {
  return value === 'audio' || value === 'text' ? value : 'off';
}

export function canInfinityReply(mode: InfinityChatMode): boolean {
  return mode !== 'off';
}

export function canInfinitySpeak(mode: InfinityChatMode, voiceEnabled: boolean): boolean {
  return mode === 'audio' && voiceEnabled;
}