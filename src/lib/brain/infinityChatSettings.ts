export type InfinityChatMode = 'off' | 'audio' | 'text';

/** Participation is opt-in; a legacy voice preference alone is not consent. */
export function resolveInfinityChatMode(value: unknown): InfinityChatMode {
  return value === 'audio' || value === 'text' ? value : 'off';
}

/** Guest defaults never inherit a member's mute or audio preference. */
export function resolveGuestInfinityChatMode(value: unknown): InfinityChatMode {
  return value === 'off' || value === 'audio' || value === 'text' ? value : 'text';
}

export function shouldOfferGuestConnection(guest: boolean, connectedPeers: number, alreadyOffered: boolean): boolean {
  return guest && connectedPeers === 0 && !alreadyOffered;
}

export function canInfinityReply(mode: InfinityChatMode): boolean {
  return mode !== 'off';
}

export function canInfinitySpeak(mode: InfinityChatMode, voiceEnabled: boolean): boolean {
  return mode === 'audio' && voiceEnabled;
}