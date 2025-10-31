import type {
  CreateStreamRoomInput,
  JoinStreamRoomOptions,
  JoinStreamRoomResponse,
  StreamModerationAction,
  StreamRoom,
  StreamRoomPromotionResponse,
  StreamRecordingToggleResponse,
} from "@/types/streaming";

const SIGNALING_BASE_PATH = "/api/signaling";
const STREAMS_BASE_PATH = "/api/streams";
const JSON_HEADERS: HeadersInit = {
  "Content-Type": "application/json",
};

interface RequestOptions extends RequestInit {
  signal?: AbortSignal;
}

type MaybeRoomPayload = StreamRoom | { room: StreamRoom };

function extractRoom(payload: MaybeRoomPayload): StreamRoom {
  if ("room" in payload && payload.room) {
    return payload.room;
  }

  return payload as StreamRoom;
}

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, init);

  if (!response.ok) {
    let message = `Streaming request failed with status ${response.status}`;

    try {
      const errorBody = await response.json();
      if (errorBody && typeof errorBody.message === "string") {
        message = errorBody.message;
      }
    } catch (error) {
      if (response.statusText) {
        message = `${message}: ${response.statusText}`;
      }
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json()) as T;
  return data;
}

function buildPath(base: string, suffix: string): string {
  if (suffix.startsWith("/")) {
    return `${base}${suffix}`;
  }

  return `${base}/${suffix}`;
}

export async function fetchActiveStreamRooms(signal?: AbortSignal): Promise<StreamRoom[]> {
  const path = buildPath(SIGNALING_BASE_PATH, "/rooms/active");
  const payload = await request<{ rooms: StreamRoom[] } | StreamRoom[]>(path, { signal });

  if (Array.isArray(payload)) {
    return payload;
  }

  return payload.rooms ?? [];
}

export async function fetchStreamRoom(roomId: string, signal?: AbortSignal): Promise<StreamRoom> {
  const path = buildPath(SIGNALING_BASE_PATH, `/rooms/${encodeURIComponent(roomId)}`);
  const payload = await request<MaybeRoomPayload>(path, { signal });
  return extractRoom(payload);
}

export async function createStreamRoom(input: CreateStreamRoomInput): Promise<StreamRoom> {
  const path = buildPath(SIGNALING_BASE_PATH, "/rooms");
  const payload = await request<MaybeRoomPayload>(path, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });

  return extractRoom(payload);
}

export async function joinStreamRoom(
  roomId: string,
  options: JoinStreamRoomOptions = {}
): Promise<JoinStreamRoomResponse> {
  const path = buildPath(SIGNALING_BASE_PATH, `/rooms/${encodeURIComponent(roomId)}/join`);
  const payload = await request<JoinStreamRoomResponse>(path, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(options ?? {}),
  });

  return payload;
}

export async function leaveStreamRoom(roomId: string): Promise<StreamRoom | null> {
  const path = buildPath(SIGNALING_BASE_PATH, `/rooms/${encodeURIComponent(roomId)}/leave`);
  const payload = await request<MaybeRoomPayload | null>(path, {
    method: "POST",
    headers: JSON_HEADERS,
  });

  if (!payload) {
    return null;
  }

  return extractRoom(payload);
}

export async function promoteStreamRoom(roomId: string): Promise<StreamRoomPromotionResponse> {
  const path = buildPath(STREAMS_BASE_PATH, `/${encodeURIComponent(roomId)}/promote`);
  const payload = await request<StreamRoomPromotionResponse>(path, {
    method: "POST",
    headers: JSON_HEADERS,
  });

  return payload;
}

export async function toggleStreamRecording(
  roomId: string,
  enabled: boolean
): Promise<StreamRecordingToggleResponse> {
  const path = buildPath(STREAMS_BASE_PATH, `/${encodeURIComponent(roomId)}/recording`);
  const payload = await request<StreamRecordingToggleResponse>(path, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ enabled }),
  });

  return payload;
}

export async function sendStreamModerationAction(
  roomId: string,
  action: StreamModerationAction
): Promise<StreamRoom> {
  if (action.type === "mute" || action.type === "unmute") {
    const path = buildPath(
      SIGNALING_BASE_PATH,
      `/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(action.peerId)}`
    );
    const payload = await request<MaybeRoomPayload>(path, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        action: action.type,
        scope: action.scope,
      }),
    });

    return extractRoom(payload);
  }

  if (action.type === "promote" || action.type === "demote") {
    const path = buildPath(
      SIGNALING_BASE_PATH,
      `/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(action.peerId)}`
    );
    const payload = await request<MaybeRoomPayload>(path, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        action: action.type,
        role: action.role,
      }),
    });

    return extractRoom(payload);
  }

  const path = buildPath(SIGNALING_BASE_PATH, `/rooms/${encodeURIComponent(roomId)}/moderation`);
  const payload = await request<MaybeRoomPayload>(path, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      action: action.type,
      peerId: action.peerId,
      durationSeconds: action.durationSeconds,
    }),
  });

  return extractRoom(payload);
}
