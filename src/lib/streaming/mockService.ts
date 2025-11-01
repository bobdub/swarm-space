import { getCurrentUser } from "@/lib/auth";
import type {
  CreateStreamRoomInput,
  JoinStreamRoomOptions,
  JoinStreamRoomResponse,
  StreamModerationAction,
  StreamParticipant,
  StreamRoom,
  StreamRoomBroadcast,
  StreamRoomPromotionResponse,
  StreamRecordingToggleResponse,
} from "@/types/streaming";

interface MockState {
  rooms: Map<string, StreamRoom>;
}

const state: MockState = {
  rooms: new Map(),
};

function cloneRoom(room: StreamRoom): StreamRoom {
  if (typeof structuredClone === "function") {
    return structuredClone(room);
  }
  return JSON.parse(JSON.stringify(room)) as StreamRoom;
}

function upsertRoom(room: StreamRoom): StreamRoom {
  state.rooms.set(room.id, cloneRoom(room));
  return fetchRoom(room.id);
}

function fetchRoom(roomId: string): StreamRoom {
  const room = state.rooms.get(roomId);
  if (!room) {
    throw new Error(`Stream room not found: ${roomId}`);
  }
  return cloneRoom(room);
}

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function resolveHostPeerId(): string {
  const currentUser = getCurrentUser();
  if (currentUser) {
    return `peer-${currentUser.id}`;
  }
  return generateId("peer");
}

function createHostParticipant(nowIso: string): StreamParticipant | null {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    return null;
  }
  const peerId = `peer-${currentUser.id}`;
  return {
    peerId,
    userId: currentUser.id,
    handle: currentUser.displayName || currentUser.username || currentUser.id,
    role: "host",
    audioMuted: false,
    videoMuted: false,
    joinedAt: nowIso,
    lastHeartbeatAt: nowIso,
    connection: "direct",
  };
}

function ensureRoomState(room: StreamRoom): StreamRoom {
  if (room.participants.length === 0) {
    room.state = "idle";
  } else if (room.state === "idle") {
    room.state = "live";
  }
  return room;
}

export async function fetchActiveStreamRooms(): Promise<StreamRoom[]> {
  return Array.from(state.rooms.values())
    .filter((room) => room.state !== "ended")
    .map((room) => cloneRoom(room));
}

export async function fetchStreamRoom(roomId: string): Promise<StreamRoom> {
  return fetchRoom(roomId);
}

export async function createStreamRoom(input: CreateStreamRoomInput): Promise<StreamRoom> {
  const nowIso = new Date().toISOString();
  const roomId = generateId("room");
  const hostPeerId = resolveHostPeerId();

  const room: StreamRoom = {
    id: roomId,
    title: input.title,
    context: input.context,
    projectId: input.context === "project" ? input.projectId : undefined,
    visibility: input.visibility,
    state: "live",
    hostPeerId,
    createdAt: nowIso,
    startedAt: nowIso,
    endedAt: undefined,
    participants: [],
    invites: [],
    recording: { status: "off" },
    summary: undefined,
    turnRelays: [],
    broadcast: undefined,
  };

  const hostParticipant = createHostParticipant(nowIso);
  if (hostParticipant) {
    room.participants.push(hostParticipant);
  }

  ensureRoomState(room);
  return upsertRoom(room);
}

export async function joinStreamRoom(
  roomId: string,
  _options: JoinStreamRoomOptions = {}
): Promise<JoinStreamRoomResponse> {
  const room = fetchRoom(roomId);
  const nowIso = new Date().toISOString();
  const currentUser = getCurrentUser();
  const userId = currentUser?.id ?? generateId("user");
  const peerId = `peer-${userId}`;

  let participant = room.participants.find((candidate) => candidate.userId === userId);
  if (!participant) {
    const handle = currentUser?.displayName || currentUser?.username || userId;
    participant = {
      peerId,
      userId,
      handle,
      role: room.participants.length === 0 ? "host" : "speaker",
      audioMuted: false,
      videoMuted: false,
      joinedAt: nowIso,
      lastHeartbeatAt: nowIso,
      connection: "direct",
    };
    room.participants.push(participant);
  } else {
    participant.lastHeartbeatAt = nowIso;
  }

  ensureRoomState(room);
  const updatedRoom = upsertRoom(room);

  return {
    room: updatedRoom,
    participant,
    meshTicket: generateId("ticket"),
    turnServers: [],
  };
}

export async function leaveStreamRoom(roomId: string): Promise<StreamRoom | null> {
  const room = fetchRoom(roomId);
  const currentUser = getCurrentUser();
  const userId = currentUser?.id;

  if (userId) {
    room.participants = room.participants.filter((participant) => participant.userId !== userId);
  } else {
    room.participants = room.participants.slice(1);
  }

  if (room.participants.length === 0) {
    room.state = "ended";
    room.endedAt = new Date().toISOString();
    upsertRoom(room);
    return null;
  }

  ensureRoomState(room);
  return upsertRoom(room);
}

export async function promoteStreamRoom(roomId: string): Promise<StreamRoomPromotionResponse> {
  const room = fetchRoom(roomId);
  const nowIso = new Date().toISOString();
  const postId = generateId("post");

  const broadcast: StreamRoomBroadcast = {
    postId,
    promotedAt: nowIso,
    state: "broadcast",
    updatedAt: nowIso,
  };

  room.broadcast = broadcast;
  room.state = room.state === "ended" ? "ended" : "live";

  const updatedRoom = upsertRoom(room);

  return {
    room: updatedRoom,
    postId,
  };
}

export async function toggleStreamRecording(
  roomId: string,
  enabled: boolean
): Promise<StreamRecordingToggleResponse> {
  const room = fetchRoom(roomId);
  const nowIso = new Date().toISOString();

  if (enabled) {
    room.recording = {
      status: "recording",
      recordingId: generateId("recording"),
      retainUntil: null,
      failureReason: null,
    };
  } else {
    room.recording = {
      status: "off",
      recordingId: undefined,
      retainUntil: null,
      failureReason: null,
    };
  }

  const updatedRoom = upsertRoom(room);
  return {
    room: updatedRoom,
    recordingId: updatedRoom.recording?.recordingId,
  };
}

export async function sendStreamModerationAction(
  roomId: string,
  action: StreamModerationAction
): Promise<StreamRoom> {
  const room = fetchRoom(roomId);
  const nowIso = new Date().toISOString();

  switch (action.type) {
    case "mute":
    case "unmute": {
      const participant = room.participants.find((candidate) => candidate.peerId === action.peerId);
      if (participant) {
        const muted = action.type === "mute";
        if (action.scope === "audio" || action.scope === "both") {
          participant.audioMuted = muted;
        }
        if (action.scope === "video" || action.scope === "both") {
          participant.videoMuted = muted;
        }
        participant.lastHeartbeatAt = nowIso;
      }
      break;
    }
    case "ban":
    case "remove": {
      room.participants = room.participants.filter((participant) => participant.peerId !== action.peerId);
      break;
    }
    case "promote":
    case "demote": {
      const participant = room.participants.find((candidate) => candidate.peerId === action.peerId);
      if (participant) {
        participant.role = action.role;
        participant.lastHeartbeatAt = nowIso;
      }
      break;
    }
    default:
      break;
  }

  if (room.participants.length === 0) {
    room.state = "ended";
    room.endedAt = nowIso;
  } else {
    ensureRoomState(room);
  }

  return upsertRoom(room);
}
