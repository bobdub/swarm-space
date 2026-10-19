import type { InfinityChatMode } from './infinityChatSettings';

/** Room consent is temporary and never enables audio or generation. */
export class InfinityRoomConsent<T extends { id: string; infinityReplyTo?: string }> {
  private decision: 'pending' | 'accept' | 'decline' = 'pending';
  private buffered: T[] = [];
  private seen = new Set<string>();
  receive(line: T, mode: InfinityChatMode): { visible: T[]; ask: boolean } {
    const key = line.infinityReplyTo ?? line.id;
    if (this.seen.has(key)) return { visible: [], ask: false };
    this.seen.add(key);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value ?? '');
    if (mode !== 'off' || this.decision === 'accept') return { visible: [line], ask: false };
    if (this.decision === 'decline') return { visible: [], ask: false };
    const ask = this.buffered.length === 0;
    this.buffered = [...this.buffered, line].slice(-100);
    return { visible: [], ask };
  }
  choose(accept: boolean): T[] {
    this.decision = accept ? 'accept' : 'decline';
    const lines = accept ? this.buffered : [];
    this.buffered = [];
    return lines;
  }
}