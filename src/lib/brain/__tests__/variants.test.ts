import { describe, it, expect } from 'vitest';
import { lobbyVariant, projectVariant, liveChatVariant } from '../variants';
import { BRAIN_ROOM_ID } from '@/hooks/useBrainVoice';

describe('BrainVariant factories', () => {
  it('lobbyVariant defaults to BRAIN_ROOM_ID and global universe', () => {
    const v = lobbyVariant({ onLeave: () => {} });
    expect(v.kind).toBe('lobby');
    expect(v.roomId).toBe(BRAIN_ROOM_ID);
    expect(v.universeKey).toBe('global');
    expect(v.capabilities.portals).toBe(true);
    expect(v.capabilities.infinityAlwaysReplies).toBe(true);
    expect(v.capabilities.promoteToFeed).toBe(false);
    expect(v.capabilities.membershipGated).toBe(false);
  });

  it('lobbyVariant binds to activeRoomId when present and enables promote', () => {
    const v = lobbyVariant({ onLeave: () => {}, activeRoomId: 'room-xyz' });
    expect(v.roomId).toBe('room-xyz');
    expect(v.universeKey).toBe('global');
    expect(v.capabilities.promoteToFeed).toBe(true);
  });

  it('projectVariant uses brain-project-<id> room and project universe key', () => {
    const v = projectVariant({
      project: { id: 'p1', name: 'Project One' },
      onLeave: () => {},
    });
    expect(v.kind).toBe('project');
    expect(v.roomId).toBe('brain-project-p1');
    expect(v.universeKey).toBe('project-p1');
    expect(v.title).toBe('Project One');
    expect(v.capabilities.membershipGated).toBe(true);
    expect(v.capabilities.infinityAlwaysReplies).toBe(false);
    expect(v.capabilities.portals).toBe(true);
    expect(v.capabilities.promoteToFeed).toBe(false);
  });

  it('projectVariant honors activeRoomId override and flips promote on', () => {
    const v = projectVariant({
      project: { id: 'p2', name: 'P2' },
      onLeave: () => {},
      activeRoomId: 'live-abc',
    });
    expect(v.roomId).toBe('live-abc');
    expect(v.capabilities.promoteToFeed).toBe(true);
  });

  it('liveChatVariant wraps a room and enables promote-to-feed', () => {
    const v = liveChatVariant({
      room: { id: 'room-1', title: 'AMA', projectId: null },
      onLeave: () => {},
    });
    expect(v.kind).toBe('liveChat');
    expect(v.roomId).toBe('room-1');
    expect(v.universeKey).toBe('liveroom-room-1');
    expect(v.title).toBe('AMA');
    expect(v.capabilities.promoteToFeed).toBe(true);
    expect(v.capabilities.portals).toBe(false);
    expect(v.capabilities.infinityAlwaysReplies).toBe(false);
  });

  it('liveChatVariant scopes universeKey to project when room belongs to one', () => {
    const v = liveChatVariant({
      room: { id: 'room-2', title: 'Standup', projectId: 'p9' },
      onLeave: () => {},
    });
    expect(v.universeKey).toBe('project-p9');
  });
});
