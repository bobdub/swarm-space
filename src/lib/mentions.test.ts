import { beforeEach, describe, expect, it, vi } from 'vitest';
const mesh = vi.hoisted(() => ({ getLibrary: vi.fn(), getConnectedPeers: vi.fn(() => []) }));
vi.mock('@/lib/p2p/swarmMesh.standalone', () => ({ getSwarmMeshStandalone: () => mesh }));
vi.mock('@/lib/store', () => ({ getAll: vi.fn(async () => []) }));
import { bindMentions, insertMention, mentionRecipient, mentionNotificationRecipients, rebaseMentions, resolveMentionCandidates, trimMentionBindings } from './mentions';
import { observeConnections } from './p2p/connectionAffinity';
import type { MentionCandidate } from './mentions';
const mike = (userId: string): MentionCandidate => ({ userId, username: 'Mike', displayName: 'Mike', trustScore: 50, isEntity: false });

describe('sovereign mention routing', () => {
  beforeEach(() => { localStorage.clear(); mesh.getLibrary.mockReturnValue([]); });
  it('keeps two identical handles bound to two different users through edits and trim', () => {
    const a = insertMention(' @mi', [], mike('a'), 1, 4);
    const b = insertMention(a.text + '@mi', a.mentions, mike('b'), a.text.length, a.text.length + 3);
    expect(b.mentions.map(m => m.userId)).toEqual(['a', 'b']);
    const text = b.text.trim();
    const mentions = trimMentionBindings(b.text, b.mentions);
    expect(mentionRecipient(text, 0, 'Mike', mentions)).toBe('a');
    expect(mentionRecipient(text, 6, 'Mike', mentions)).toBe('b');
    const shifted = rebaseMentions(text, 'Hey ' + text, mentions);
    expect(shifted.map(m => m.startIndex)).toEqual([4, 10]);
    expect(rebaseMentions(text, text.replace('@Mike', '@Other'), mentions).map(m => m.userId)).toEqual(['b']);
  });
  it('prioritizes hours together and auto-resolves the default to canonical userId', async () => {
    localStorage.setItem('me', JSON.stringify({ id: 'ranking-owner' }));
    mesh.getLibrary.mockReturnValue([{ peerId: 'peer-a', nodeId: 'node-a', userId: 'a', username: 'Mike' }, { peerId: 'peer-b', nodeId: 'node-b', userId: 'b', username: 'Mike' }]);
    observeConnections('ranking-owner', [{ peerId: 'peer-b', userId: 'b', connectedAt: Date.now() - 14_400_000 }]);
    expect((await resolveMentionCandidates('mi')).map(c => c.userId)).toEqual(['b', 'a']);
    expect((await bindMentions('Hey @Mike tonight?'))[0].userId).toBe('b');
    const selected = insertMention('@mi', [], mike('a'), 0, 3);
    expect((await bindMentions(selected.text, selected.mentions))[0].userId).toBe('a');
  });
  it('does not reinterpret unknown new tags through the readers cache', () => {
    expect(mentionRecipient('@Mike', 0, 'Mike', [], new Map([['mike', 'wrong']]))).toBeUndefined();
    expect(mentionRecipient('@Mike', 0, 'Mike', undefined, new Map([['mike', 'legacy']]))).toBe('legacy');
  });
  it('deduplicates notifications by identity, not handle', () => {
    const first = insertMention('@mi', [], mike('a'), 0, 3);
    expect(mentionNotificationRecipients([...first.mentions, ...first.mentions, { ...first.mentions[0], userId: 'b' }], 'author')).toEqual(['a', 'b']);
  });
});