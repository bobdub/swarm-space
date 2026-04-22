/**
 * BrainVariant — single source of truth describing which "Brain" a user is
 * inside. Three variants today (lobby, project, liveChat) all render the
 * same `BrainUniverseScene`; capability flags declare per-variant behavior
 * so the scene + chat panel never have to string-sniff room ids again.
 */
import { BRAIN_ROOM_ID } from '@/hooks/useBrainVoice';
import type { Project } from '@/types';

export type BrainVariantKind = 'lobby' | 'project' | 'liveChat';

export interface BrainVariantCapabilities {
  /** Drop-portal button in the HUD. */
  portals: boolean;
  /** Promote-to-feed control in the chat panel header. */
  promoteToFeed: boolean;
  /** Infinity speaks even when not directly addressed. */
  infinityAlwaysReplies: boolean;
  /** Wrapper enforces project membership before the variant is built. */
  membershipGated: boolean;
}

export interface BrainVariant {
  kind: BrainVariantKind;
  /** Voice + chat + presence room id. */
  roomId: string;
  /** Persistence namespace for pieces / portals / field snapshot. */
  universeKey: string;
  /** Title chip shown in the HUD (project name, room title, …). */
  title?: string;
  leaveLabel: string;
  onLeave: () => void;
  capabilities: BrainVariantCapabilities;
}

/** Public Brain — `/brain`. Lobby is open, Infinity always chatters. */
export function lobbyVariant(opts: {
  onLeave: () => void;
  /** When a live room is active, bind voice/chat to it instead of the lobby id. */
  activeRoomId?: string;
}): BrainVariant {
  return {
    kind: 'lobby',
    roomId: opts.activeRoomId ?? BRAIN_ROOM_ID,
    universeKey: 'global',
    leaveLabel: 'Leave',
    onLeave: opts.onLeave,
    capabilities: {
      portals: true,
      // Lobby only gets a promote button when there's actually a live room.
      promoteToFeed: Boolean(opts.activeRoomId),
      infinityAlwaysReplies: true,
      membershipGated: false,
    },
  };
}

/** Per-project Brain — `/projects/:id/hub`. Members only. */
export function projectVariant(opts: {
  project: Pick<Project, 'id' | 'name'>;
  onLeave: () => void;
  activeRoomId?: string;
}): BrainVariant {
  const projectRoomId = `brain-project-${opts.project.id}`;
  return {
    kind: 'project',
    roomId: opts.activeRoomId ?? projectRoomId,
    universeKey: `project-${opts.project.id}`,
    title: opts.project.name,
    leaveLabel: 'Leave Universe',
    onLeave: opts.onLeave,
    capabilities: {
      portals: true,
      promoteToFeed: Boolean(opts.activeRoomId),
      // Project hubs: Infinity only chimes in when addressed.
      infinityAlwaysReplies: false,
      membershipGated: true,
    },
  };
}

/** Live-chat Brain — wraps an explicit streaming room. */
export function liveChatVariant(opts: {
  room: { id: string; title?: string; projectId?: string | null };
  onLeave: () => void;
}): BrainVariant {
  const universeKey = opts.room.projectId
    ? `project-${opts.room.projectId}`
    : `liveroom-${opts.room.id}`;
  return {
    kind: 'liveChat',
    roomId: opts.room.id,
    universeKey,
    title: opts.room.title,
    leaveLabel: 'Leave Room',
    onLeave: opts.onLeave,
    capabilities: {
      // No portal authoring inside ephemeral live rooms.
      portals: false,
      promoteToFeed: true,
      infinityAlwaysReplies: false,
      membershipGated: false,
    },
  };
}
