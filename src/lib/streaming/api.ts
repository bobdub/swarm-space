import type {
  CreateStreamRoomInput,
  JoinStreamRoomOptions,
  JoinStreamRoomResponse,
  StreamModerationAction,
  StreamRoom,
  StreamRoomPromotionResponse,
  StreamRecordingToggleResponse,
} from "@/types/streaming";
import {
  createStreamRoom as createMockStreamRoom,
  fetchActiveStreamRooms as fetchMockActiveStreamRooms,
  fetchStreamRoom as fetchMockStreamRoom,
  joinStreamRoom as joinMockStreamRoom,
  leaveStreamRoom as leaveMockStreamRoom,
  promoteStreamRoom as promoteMockStreamRoom,
  sendStreamModerationAction as sendMockStreamModerationAction,
  toggleStreamRecording as toggleMockStreamRecording,
} from "./mockService";

const SIGNALING_BASE_PATH = "/api/signaling";
const STREAMS_BASE_PATH = "/api/streams";
const STREAMING_API_BASE_URL = import.meta.env?.VITE_STREAMING_API_BASE_URL as string | undefined;
const STREAMING_USE_MOCK_ENV = import.meta.env?.VITE_STREAMING_USE_MOCK;

const STREAMING_API_MOCK_ENABLED_INTERNAL = (() => {
  if (STREAMING_USE_MOCK_ENV === "false" || STREAMING_USE_MOCK_ENV === "0") {
    return false;
  }

  if (STREAMING_USE_MOCK_ENV === "true" || STREAMING_USE_MOCK_ENV === "1") {
    return true;
  }

  return Boolean(import.meta.env?.DEV);
})();

export const STREAMING_API_MOCK_ENABLED = STREAMING_API_MOCK_ENABLED_INTERNAL;
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

function resolveRequestUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  if (STREAMING_API_BASE_URL) {
    const normalizedBase = STREAMING_API_BASE_URL.replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  return path;
}

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const response = await fetch(resolveRequestUrl(path), init);

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

  const contentType = response.headers.get("content-type")?.toLowerCase();

  const statusText = response.statusText ? ` ${response.statusText}` : "";
  const errorFromBody = (bodyText?: string): Error => {
    const snippet = bodyText?.trim().slice(0, 200);
    const message = snippet
      ? `Streaming response was not valid JSON (status ${response.status}${statusText}): ${snippet}`
      : `Streaming response was not valid JSON (status ${response.status}${statusText}).`;
    return new Error(message);
  };

  const normalizedContentType = contentType ?? "";
  const isLikelyJson = normalizedContentType.includes("json");

  if (isLikelyJson) {
    const clone = response.clone();

    try {
      const data = (await response.json()) as T;
      return data;
    } catch (error) {
      const fallbackBody = await clone.text();
      throw errorFromBody(fallbackBody);
    }
  }

  const fallbackBody = await response.text();

  try {
    const data = JSON.parse(fallbackBody) as T;
    return data;
  } catch (error) {
    throw errorFromBody(fallbackBody);
  }
}

function buildPath(base: string, suffix: string): string {
  if (suffix.startsWith("/")) {
    return `${base}${suffix}`;
  }

  return `${base}/${suffix}`;
}

export async function fetchActiveStreamRooms(signal?: AbortSignal): Promise<StreamRoom[]> {
  if (STREAMING_API_MOCK_ENABLED) {
    return fetchMockActiveStreamRooms();
  }

  const path = buildPath(SIGNALING_BASE_PATH, "/rooms/active");
  const payload = await request<{ rooms: StreamRoom[] } | StreamRoom[]>(path, { signal });

  if (Array.isArray(payload)) {
    return payload;
  }

  return payload.rooms ?? [];
}

export async function fetchStreamRoom(roomId: string, signal?: AbortSignal): Promise<StreamRoom> {
  if (STREAMING_API_MOCK_ENABLED) {
    return fetchMockStreamRoom(roomId);
  }

  const path = buildPath(SIGNALING_BASE_PATH, `/rooms/${encodeURIComponent(roomId)}`);
  const payload = await request<MaybeRoomPayload>(path, { signal });
  return extractRoom(payload);
}

export async function createStreamRoom(input: CreateStreamRoomInput): Promise<StreamRoom> {
  if (STREAMING_API_MOCK_ENABLED) {
    return createMockStreamRoom(input);
  }

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
  if (STREAMING_API_MOCK_ENABLED) {
    return joinMockStreamRoom(roomId, options);
  }

  const path = buildPath(SIGNALING_BASE_PATH, `/rooms/${encodeURIComponent(roomId)}/join`);
  const payload = await request<JoinStreamRoomResponse>(path, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(options ?? {}),
  });

  return payload;
}

export async function leaveStreamRoom(roomId: string): Promise<StreamRoom | null> {
  if (STREAMING_API_MOCK_ENABLED) {
    return leaveMockStreamRoom(roomId);
  }

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
  if (STREAMING_API_MOCK_ENABLED) {
    return promoteMockStreamRoom(roomId);
  }

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
  if (STREAMING_API_MOCK_ENABLED) {
    return toggleMockStreamRecording(roomId, enabled);
  }

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
  if (STREAMING_API_MOCK_ENABLED) {
    return sendMockStreamModerationAction(roomId, action);
  }

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
      ...(action.type === 'ban' || action.type === 'remove' || action.type === 'promote' || action.type === 'demote'
        ? {}
        : {}),
      ...('durationSeconds' in action ? { durationSeconds: action.durationSeconds } : {}),
      ...('scope' in action ? { scope: action.scope } : {}),
      ...('role' in action ? { role: action.role } : {}),
    }),
  });

  return extractRoom(payload);
}
