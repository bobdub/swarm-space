/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
  useReducer,
  useRef,
  useCallback,
  useEffect,
} from "react";
import {
  createStreamRoom,
  fetchActiveStreamRooms,
  fetchStreamRoom,
  joinStreamRoom,
  leaveStreamRoom,
  promoteStreamRoom,
  sendStreamModerationAction,
  toggleStreamRecording,
  STREAMING_API_MOCK_ENABLED,
} from "@/lib/streaming/api";
import { injectRoom as injectMockRoom } from "@/lib/streaming/mockService";
import {
  startStreamSync,
  stopStreamSync,
  broadcastRoom as broadcastRoomToMesh,
  broadcastRoomEnded as broadcastRoomEndedToMesh,
  injectLocalRoom,
  getKnownRoom,
  requestRoom as requestRoomFromMesh,
} from "@/lib/streaming/streamSync.standalone";
import { startSignalingBridge, stopSignalingBridge } from "@/lib/streaming/webrtcSignalingBridge.standalone";
import { getSwarmMeshStandalone } from "@/lib/p2p/swarmMesh.standalone";
import { get, put } from "@/lib/store";
import { getCurrentUser } from "@/lib/auth";
import type { Post } from "@/types";
import type {
  CreateStreamRoomInput,
  JoinStreamRoomOptions,
  StreamBroadcastPhase,
  StreamModerationAction,
  StreamRoom,
  StreamingSocketMessage,
} from "@/types/streaming";

export interface StreamingContextValue {
  status: "idle" | "connecting" | "connected" | "error";
  isStreamingEnabled: boolean;
  activeRoom: StreamRoom | null;
  roomsById: Record<string, StreamRoom>;
  lastError: Error | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  createRoom: (input: CreateStreamRoomInput) => Promise<StreamRoom>;
  startRoom: (input: CreateStreamRoomInput) => Promise<StreamRoom>;
  joinRoom: (roomId: string, options?: JoinStreamRoomOptions) => Promise<void>;
  leaveRoom: (roomId?: string) => Promise<void>;
  refreshRoom: (roomId: string) => Promise<void>;
  promoteRoomToPost: (roomId: string) => Promise<{ room: StreamRoom; postId: string }>;
  setRoomBroadcastState: (
    roomId: string,
    state: "backstage" | "broadcast" | "ended",
    options?: { autoPromote?: boolean }
  ) => Promise<StreamRoom>;
  sendModerationAction: (
    roomId: string,
    action: StreamModerationAction
  ) => Promise<void>;
  toggleRecording: (roomId: string, enabled: boolean) => Promise<void>;
}

interface StreamingState {
  status: "idle" | "connecting" | "connected" | "error";
  isStreamingEnabled: boolean;
  activeRoomId: string | null;
  roomsById: Record<string, StreamRoom>;
  lastError: Error | null;
}

type StreamingAction =
  | { type: "set-status"; status: StreamingState["status"] }
  | { type: "set-error"; error: Error | null; status?: StreamingState["status"] }
  | { type: "set-enabled"; enabled: boolean }
  | { type: "set-active-room"; roomId: string | null }
  | { type: "set-rooms"; rooms: StreamRoom[] }
  | { type: "upsert-room"; room: StreamRoom }
  | { type: "remove-room"; roomId: string }
  | { type: "mark-room-ended"; roomId: string; endedAt: string };

const STREAMING_ENABLED = (() => {
  const raw = import.meta.env?.VITE_STREAMING_ENABLED;
  if (raw === "false" || raw === "0") {
    return false;
  }
  if (raw === "true" || raw === "1") {
    return true;
  }
  return true;
})();

const STREAMING_SOCKET_URL = import.meta.env?.VITE_STREAMING_SOCKET_URL ?? "/api/signaling/ws";

const StreamingContext = createContext<StreamingContextValue | null>(null);

function isRoomEnded(room: StreamRoom | undefined): boolean {
  if (!room) return false;
  return room.state === "ended" || room.broadcast?.state === "ended" || Boolean(room.endedAt);
}

function getRoomOrderTs(room: StreamRoom | undefined): number {
  if (!room) return 0;
  return new Date(
    room.broadcast?.updatedAt ??
      room.endedAt ??
      room.startedAt ??
      room.createdAt,
  ).getTime();
}

function mergeRoomState(existing: StreamRoom | undefined, incoming: StreamRoom): StreamRoom {
  if (!existing) return incoming;

  const existingEnded = isRoomEnded(existing);
  const incomingEnded = isRoomEnded(incoming);

  // Terminal-state guard: once ended, no stale update may reopen the room.
  if (existingEnded && !incomingEnded) {
    return existing;
  }
  if (!existingEnded && incomingEnded) {
    return incoming;
  }

  if (existingEnded && incomingEnded) {
    const existingEndedTs = new Date(existing.endedAt ?? existing.broadcast?.updatedAt ?? 0).getTime();
    const incomingEndedTs = new Date(incoming.endedAt ?? incoming.broadcast?.updatedAt ?? 0).getTime();
    return incomingEndedTs >= existingEndedTs ? incoming : existing;
  }

  const existingTs = getRoomOrderTs(existing);
  const incomingTs = getRoomOrderTs(incoming);
  return incomingTs >= existingTs ? incoming : existing;
}

function streamingReducer(state: StreamingState, action: StreamingAction): StreamingState {
  switch (action.type) {
    case "set-status":
      return { ...state, status: action.status };
    case "set-error":
      return {
        ...state,
        status: action.status ?? state.status,
        lastError: action.error,
      };
    case "set-enabled":
      return { ...state, isStreamingEnabled: action.enabled };
    case "set-active-room":
      return { ...state, activeRoomId: action.roomId };
    case "set-rooms": {
      const roomsById: Record<string, StreamRoom> = {};
      for (const room of action.rooms) {
        roomsById[room.id] = room;
      }
      const nextActiveId = state.activeRoomId && roomsById[state.activeRoomId] ? state.activeRoomId : null;
      return {
        ...state,
        roomsById,
        activeRoomId: nextActiveId,
      };
    }
    case "upsert-room": {
      const mergedRoom = mergeRoomState(state.roomsById[action.room.id], action.room);
      return {
        ...state,
        roomsById: {
          ...state.roomsById,
          [action.room.id]: mergedRoom,
        },
      };
    }
    case "remove-room": {
      if (!state.roomsById[action.roomId]) {
        return state;
      }
      const roomsById = { ...state.roomsById };
      delete roomsById[action.roomId];
      const nextActiveId = state.activeRoomId === action.roomId ? null : state.activeRoomId;
      return {
        ...state,
        roomsById,
        activeRoomId: nextActiveId,
      };
    }
    case "mark-room-ended": {
      const existingRoom = state.roomsById[action.roomId];
      if (!existingRoom) {
        return state;
      }
      const endedAt = action.endedAt;
      const updatedRoom: StreamRoom = {
        ...existingRoom,
        state: "ended",
        endedAt,
        broadcast: existingRoom.broadcast
          ? {
              ...existingRoom.broadcast,
              state: "ended",
              updatedAt: endedAt,
            }
          : existingRoom.broadcast,
      };
      return {
        ...state,
        roomsById: {
          ...state.roomsById,
          [action.roomId]: updatedRoom,
        },
        activeRoomId: state.activeRoomId === action.roomId ? null : state.activeRoomId,
      };
    }
    default:
      return state;
  }
}

function resolveSocketUrl(path: string): string {
  if (/^wss?:\/\//.test(path)) {
    return path;
  }

  if (typeof window === "undefined" || !window.location) {
    return path;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}//${window.location.host}${normalized}`;
}

function normalizeError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(fallback);
}

export function StreamingProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [state, baseDispatch] = useReducer(streamingReducer, {
    status: "idle",
    isStreamingEnabled: STREAMING_ENABLED,
    activeRoomId: null,
    roomsById: {},
    lastError: null,
  });
  const isMountedRef = useRef(true);
  const statusRef = useRef<StreamingState["status"]>("idle");
  const activeRoomIdRef = useRef<string | null>(null);
  const enabledRef = useRef<boolean>(STREAMING_ENABLED);
  const socketRef = useRef<WebSocket | null>(null);

  const resolveLifecycleStatus = useCallback((): StreamingState["status"] => {
    const socket = socketRef.current;
    if (socket) {
      const openState =
        typeof WebSocket !== "undefined" ? WebSocket.OPEN : /* WebSocket.OPEN */ 1;
      const connectingState =
        typeof WebSocket !== "undefined"
          ? WebSocket.CONNECTING
          : /* WebSocket.CONNECTING */ 0;

      if (socket.readyState === openState) {
        return "connected";
      }
      if (socket.readyState === connectingState) {
        return "connecting";
      }
    }

    return "idle";
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        try {
          socket.close();
        } catch (error) {
          console.warn("[Streaming] Failed to close socket during unmount", error);
        }
      }
    };
  }, []);

  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  useEffect(() => {
    activeRoomIdRef.current = state.activeRoomId;
  }, [state.activeRoomId]);

  useEffect(() => {
    enabledRef.current = state.isStreamingEnabled;
  }, [state.isStreamingEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const endedRooms = Object.values(state.roomsById).filter(
      (room) => room.state === "ended" && room.broadcast?.postId,
    );

    if (endedRooms.length === 0) {
      return;
    }

    endedRooms.forEach((room) => {
      const postId = room.broadcast?.postId;
      if (!postId) {
        return;
      }

      void (async () => {
        try {
          const post = await get<Post>("posts", postId);
          if (!post) {
            return;
          }

          if (post.stream?.broadcastState === "ended") {
            return;
          }

          const endedAt = room.endedAt ?? new Date().toISOString();
          const updatedPost: Post = {
            ...post,
            type: "stream",
            stream: {
              roomId: room.id,
              title: post.stream?.title ?? room.title,
              context: post.stream?.context ?? room.context,
              projectId: post.stream?.projectId ?? room.projectId ?? null,
              visibility: post.stream?.visibility ?? room.visibility,
              broadcastState: "ended",
              promotedAt:
                post.stream?.promotedAt ?? room.broadcast?.promotedAt ?? endedAt,
              recordingId: post.stream?.recordingId ?? room.recording?.recordingId ?? null,
              summaryId: post.stream?.summaryId ?? room.summary?.summaryId ?? null,
              endedAt,
            },
          };

          await put("posts", updatedPost);
          window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
        } catch (error) {
          console.warn("[Streaming] Failed to persist ended stream metadata", error);
        }
      })();
    });
  }, [state.roomsById]);

  const dispatch = useCallback(
    (action: StreamingAction) => {
      if (isMountedRef.current) {
        baseDispatch(action);
      }
    },
    [baseDispatch]
  );

  const clearError = useCallback(() => {
    if (statusRef.current === "error") {
      const nextStatus = resolveLifecycleStatus();
      statusRef.current = nextStatus;
      dispatch({ type: "set-error", error: null, status: nextStatus });
      return;
    }

    dispatch({ type: "set-error", error: null });
  }, [dispatch, resolveLifecycleStatus]);

  const processSocketPayload = useCallback(
    (payload: StreamingSocketMessage) => {
      switch (payload.type) {
        case "room:update":
          dispatch({ type: "upsert-room", room: payload.room });
          break;
        case "room:ended":
        case "room:deleted":
        case "room:closed":
        case "room:remove": {
          const endedAt = new Date().toISOString();
          dispatch({ type: "mark-room-ended", roomId: payload.roomId, endedAt });
          break;
        }
        case "rooms:sync":
        case "rooms:hydrate":
        case "rooms:update":
          dispatch({ type: "set-rooms", rooms: payload.rooms });
          break;
        case "room:error":
        case "error":
          dispatch({
            type: "set-error",
            error: new Error(payload.message),
          });
          break;
        case "heartbeat":
          if (payload.rooms) {
            dispatch({ type: "set-rooms", rooms: payload.rooms });
          }
          break;
        default:
          break;
      }
    },
    [dispatch]
  );

  const connect = useCallback(async () => {
    if (!enabledRef.current) {
      const error = new Error("Streaming is disabled");
      dispatch({ type: "set-error", error });
      throw error;
    }

    if (socketRef.current) {
      const readyState = socketRef.current.readyState;
      if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
        return;
      }
    }

    if (statusRef.current === "connecting") {
      return;
    }

    // In mock mode, once connected, don't re-fetch rooms — it would
    // dispatch set-rooms and potentially clear a just-set activeRoomId
    if (STREAMING_API_MOCK_ENABLED && statusRef.current === "connected") {
      return;
    }

    dispatch({ type: "set-status", status: "connecting" });

    try {
      const rooms = await fetchActiveStreamRooms();
      dispatch({ type: "set-rooms", rooms });
      clearError();
    } catch (error) {
      const normalized = normalizeError(error, "Failed to load active stream rooms");
      dispatch({ type: "set-error", error: normalized, status: "error" });
    }

    if (STREAMING_API_MOCK_ENABLED) {
      statusRef.current = "connected";
      dispatch({ type: "set-status", status: "connected" });
      return;
    }

    try {
      const socket = new WebSocket(resolveSocketUrl(STREAMING_SOCKET_URL));
      socketRef.current = socket;

      socket.onopen = () => {
        statusRef.current = "connected";
        dispatch({ type: "set-status", status: "connected" });
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          const raw = JSON.parse(event.data) as StreamingSocketMessage | StreamingSocketMessage[];
          if (Array.isArray(raw)) {
            raw.forEach(processSocketPayload);
          } else if (raw && typeof raw === "object") {
            processSocketPayload(raw);
          }
        } catch (error) {
          console.warn("[Streaming] Failed to parse socket message", error, event.data);
        }
      };

      socket.onerror = () => {
        dispatch({
          type: "set-error",
          error: new Error("Streaming signaling socket error"),
          status: "error",
        });
      };

      socket.onclose = () => {
        socketRef.current = null;
        statusRef.current = "idle";
        dispatch({ type: "set-status", status: "idle" });
      };
    } catch (error) {
      const normalized = normalizeError(error, "Failed to establish streaming socket");
      dispatch({ type: "set-error", error: normalized, status: "error" });
      throw normalized;
    }
  }, [clearError, dispatch, processSocketPayload]);

  const disconnect = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;

    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch (error) {
        console.warn("[Streaming] Failed to close socket", error);
      }
    }

    statusRef.current = "idle";
    dispatch({ type: "set-status", status: "idle" });
  }, [dispatch]);

  const createRoom = useCallback(
    async (input: CreateStreamRoomInput) => {
      if (!enabledRef.current) {
        const error = new Error("Streaming is disabled");
        dispatch({ type: "set-error", error });
        throw error;
      }

      try {
        const room = await createStreamRoom(input);
        dispatch({ type: "upsert-room", room });
        dispatch({ type: "set-active-room", roomId: room.id });
        // Register with P2P sync so peers can discover this room
        injectLocalRoom(room);
        broadcastRoomToMesh(room);
        clearError();
        return room;
      } catch (error) {
        const normalized = normalizeError(error, "Failed to create stream room");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [clearError, dispatch]
  );

  const joinRoom = useCallback(
    async (roomId: string, options?: JoinStreamRoomOptions) => {
      try {
        const response = await joinStreamRoom(roomId, options);
        dispatch({ type: "upsert-room", room: response.room });
        dispatch({ type: "set-active-room", roomId: response.room.id });
        // Share participant changes with peers so counts stay in sync.
        injectLocalRoom(response.room);
        broadcastRoomToMesh(response.room);
        clearError();
      } catch (error) {
        const normalized = normalizeError(error, "Failed to join stream room");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [clearError, dispatch]
  );

  const leaveRoom = useCallback(
    async (roomId?: string) => {
      const targetRoomId = roomId ?? activeRoomIdRef.current;
      if (!targetRoomId) {
        return;
      }

      try {
        const updatedRoom = await leaveStreamRoom(targetRoomId);
        if (updatedRoom) {
          dispatch({ type: "upsert-room", room: updatedRoom });
          broadcastRoomToMesh(updatedRoom);
        } else {
          dispatch({ type: "remove-room", roomId: targetRoomId });
          // Room ended (no participants left) — notify peers
          broadcastRoomEndedToMesh(targetRoomId);
        }

        if (activeRoomIdRef.current === targetRoomId) {
          dispatch({ type: "set-active-room", roomId: null });
        }

        clearError();
      } catch (error) {
        const normalized = normalizeError(error, "Failed to leave stream room");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [clearError, dispatch]
  );

  const refreshRoom = useCallback(
    async (roomId: string) => {
      try {
        const room = await fetchStreamRoom(roomId);
        dispatch({ type: "upsert-room", room });
        clearError();
      } catch (error) {
        const normalized = normalizeError(error, "Failed to refresh stream room");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [clearError, dispatch]
  );

  const promoteRoomToPost = useCallback(
    async (roomId: string) => {
      try {
        const existingRoom = state.roomsById[roomId];
        if (existingRoom && existingRoom.visibility !== "public") {
          throw new Error("Only public livestreams can be promoted");
        }
        const response = await promoteStreamRoom(roomId);
        const nowIso = new Date().toISOString();
        const promotedState =
          response.room.state === "ended" || response.room.broadcast?.state === "ended"
            ? "ended"
            : "backstage";
        const broadcast = {
          postId: response.postId,
          promotedAt: response.room.broadcast?.promotedAt ?? nowIso,
          state: promotedState as StreamBroadcastPhase,
          updatedAt: nowIso,
          ...response.room.broadcast,
        };
        const promotedRoom: StreamRoom = {
          ...response.room,
          broadcast,
        };
        promotedRoom.broadcast = {
          ...broadcast,
          postId: response.postId,
          state: promotedState,
          updatedAt: nowIso,
        };

        dispatch({ type: "upsert-room", room: promotedRoom });
        // Broadcast promoted room to all peers so they can see & join
        injectLocalRoom(promotedRoom);
        broadcastRoomToMesh(promotedRoom);

        const currentUser = getCurrentUser();
        const existingPost = await get<Post>("posts", response.postId);
        const promotedAt = promotedRoom.broadcast?.promotedAt ?? nowIso;
        const resolvedAuthorId = existingPost?.author ?? currentUser?.id ?? promotedRoom.hostPeerId;
        const resolvedAuthorName =
          existingPost?.authorName ??
          currentUser?.displayName ??
          currentUser?.username ??
          "Host";
        const nextPost: Post = existingPost
          ? {
              ...existingPost,
              type: "stream",
              content: existingPost.content?.trim() ? existingPost.content : promotedRoom.title,
              projectId: null,
              stream: {
                roomId: promotedRoom.id,
                title: existingPost.stream?.title ?? promotedRoom.title,
                context: existingPost.stream?.context ?? promotedRoom.context,
                projectId: existingPost.stream?.projectId ?? promotedRoom.projectId ?? null,
                visibility: existingPost.stream?.visibility ?? promotedRoom.visibility,
                promotedAt: existingPost.stream?.promotedAt ?? promotedAt,
                broadcastState: promotedRoom.broadcast?.state ?? "backstage",
                recordingId: existingPost.stream?.recordingId ?? promotedRoom.recording?.recordingId ?? null,
                summaryId: existingPost.stream?.summaryId ?? promotedRoom.summary?.summaryId ?? null,
                endedAt:
                  existingPost.stream?.endedAt ??
                  (promotedRoom.broadcast?.state === "ended"
                    ? (promotedRoom.endedAt ?? promotedRoom.broadcast?.updatedAt ?? nowIso)
                    : null),
              },
            }
          : {
              id: response.postId,
              author: resolvedAuthorId,
              authorName: resolvedAuthorName,
              authorAvatarRef: currentUser?.profile?.avatarRef,
              authorBannerRef: currentUser?.profile?.bannerRef,
              authorBadgeSnapshots: undefined,
              projectId: null,
              type: "stream",
              content: promotedRoom.title,
              manifestIds: [],
              createdAt: nowIso,
              nsfw: false,
              likes: 0,
              reactions: [],
              comments: [],
              stream: {
                roomId: promotedRoom.id,
                title: promotedRoom.title,
                context: promotedRoom.context,
                projectId: promotedRoom.projectId ?? null,
                visibility: promotedRoom.visibility,
                promotedAt,
                broadcastState: promotedRoom.broadcast?.state ?? "backstage",
                recordingId: promotedRoom.recording?.recordingId ?? null,
                summaryId: promotedRoom.summary?.summaryId ?? null,
                endedAt:
                  promotedRoom.broadcast?.state === "ended"
                    ? (promotedRoom.endedAt ?? promotedRoom.broadcast?.updatedAt ?? nowIso)
                    : null,
              },
            };

        if (existingPost) {
          nextPost.createdAt = nowIso;
        }

        await put("posts", nextPost);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
        }
        clearError();
        return { ...response, room: promotedRoom };
      } catch (error) {
        const normalized = normalizeError(error, "Failed to promote stream room");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [clearError, dispatch, state.roomsById]
  );

  const setRoomBroadcastState = useCallback(
    async (
      roomId: string,
      broadcastState: "backstage" | "broadcast" | "ended",
      options?: { autoPromote?: boolean }
    ): Promise<StreamRoom> => {
      const existing = state.roomsById[roomId];
      if (!existing) {
        throw new Error("Room not found");
      }

      let targetRoom = existing;
      if (!targetRoom.broadcast?.postId && options?.autoPromote) {
        const promotion = await promoteRoomToPost(roomId);
        targetRoom = promotion.room;
      }

      if (!targetRoom.broadcast?.postId) {
        throw new Error("Room must be promoted before broadcast can be activated");
      }

      const nowIso = new Date().toISOString();
      const nextRoom: StreamRoom = {
        ...targetRoom,
        broadcast: {
          postId: targetRoom.broadcast.postId,
          promotedAt: targetRoom.broadcast.promotedAt ?? nowIso,
          state: broadcastState,
          updatedAt: nowIso,
        },
      };

      dispatch({ type: "upsert-room", room: nextRoom });
      injectLocalRoom(nextRoom);
      broadcastRoomToMesh(nextRoom);

      try {
        const post = await get<Post>("posts", targetRoom.broadcast.postId);
        if (post?.stream) {
          const updatedPost: Post = {
            ...post,
            type: "stream",
            stream: {
              ...post.stream,
              roomId: targetRoom.id,
              title: post.stream.title ?? targetRoom.title,
              context: post.stream.context ?? targetRoom.context,
              projectId: post.stream.projectId ?? targetRoom.projectId ?? null,
              visibility: post.stream.visibility ?? targetRoom.visibility,
              promotedAt: post.stream.promotedAt ?? targetRoom.broadcast.promotedAt ?? nowIso,
              broadcastState,
              endedAt:
                broadcastState === "ended"
                  ? (post.stream.endedAt ?? nowIso)
                  : null,
            },
          };
          await put("posts", updatedPost);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
          }
        }
      } catch (error) {
        console.warn("[Streaming] Failed to synchronize post broadcast state", error);
      }

      clearError();
      return nextRoom;
    },
    [clearError, dispatch, promoteRoomToPost, state.roomsById]
  );

  const sendModerationActionFn = useCallback(
    async (roomId: string, action: StreamModerationAction) => {
      try {
        const room = await sendStreamModerationAction(roomId, action);
        dispatch({ type: "upsert-room", room });
        clearError();
      } catch (error) {
        const normalized = normalizeError(error, "Failed to apply moderation action");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [clearError, dispatch]
  );

  const toggleRecordingFn = useCallback(
    async (roomId: string, enabled: boolean) => {
      try {
        const response = await toggleStreamRecording(roomId, enabled);
        dispatch({ type: "upsert-room", room: response.room });
        clearError();
      } catch (error) {
        const normalized = normalizeError(error, "Failed to toggle recording");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [clearError, dispatch]
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!state.isStreamingEnabled) {
      disconnect();
      return;
    }

    connect().catch((error) => {
      console.warn("[Streaming] Failed to establish connection", error);
    });

    return () => {
      disconnect();
    };
    // connect & disconnect use refs internally and are stable — omit from deps
    // to prevent disconnect→reconnect cycles that clear activeRoom
  }, [state.isStreamingEnabled]);

  // ── P2P Stream Sync ─────────────────────────────────────────────────
  useEffect(() => {
    if (!state.isStreamingEnabled) return;

    // Start mesh sync and WebRTC signaling bridge
    const mesh = getSwarmMeshStandalone();
    const stopSync = startStreamSync(mesh);
    const stopBridge = startSignalingBridge(mesh);

    // Listen for room snapshots from peers
    const handleRoomSync = (e: Event) => {
      const room = (e as CustomEvent).detail as StreamRoom;
      if (!room?.id) return;
      // Inject into mock service so fetchStreamRoom/refreshRoom works
      if (STREAMING_API_MOCK_ENABLED) {
        injectMockRoom(room);
      }
      dispatch({ type: "upsert-room", room });
    };

    // Listen for room ended from peers
      const handleRoomEnded = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const payload =
        typeof detail === "string"
          ? { roomId: detail, endedAt: new Date().toISOString(), room: undefined }
          : (detail as { roomId?: string; endedAt?: string; room?: StreamRoom } | undefined);
      const roomId = payload?.roomId;
      if (!roomId) return;
      if (payload.room) {
        dispatch({ type: "upsert-room", room: payload.room });
      }
      dispatch({
        type: "mark-room-ended",
        roomId,
        endedAt: payload?.endedAt ?? payload?.room?.endedAt ?? new Date().toISOString(),
      });
    };

    // Listen for posts with stream metadata arriving via P2P content sync.
    // When a peer receives a post that references a stream room, we need to
    // ensure the room data is available locally so the Join button renders.
    const handleStreamPostReceived = (e: Event) => {
      const postData = (e as CustomEvent).detail as Record<string, unknown> | undefined;
      if (!postData) return;
      const streamMeta = postData.stream as Record<string, unknown> | undefined;
      if (!streamMeta || !streamMeta.roomId) return;
      const roomId = streamMeta.roomId as string;

      // Try to get it from the stream sync registry
      const knownRoom = getKnownRoom(roomId);
      if (knownRoom) {
        if (STREAMING_API_MOCK_ENABLED) {
          injectMockRoom(knownRoom as unknown as StreamRoom);
        }
        dispatch({ type: "upsert-room", room: knownRoom as unknown as StreamRoom });
      } else {
        // Request room data from peers via stream-rooms channel
        requestRoomFromMesh(roomId);
      }
    };

    window.addEventListener("stream-room-sync", handleRoomSync);
    window.addEventListener("stream-room-ended", handleRoomEnded);
    window.addEventListener("p2p-stream-post-received", handleStreamPostReceived);

    return () => {
      stopBridge();
      stopSync();
      window.removeEventListener("stream-room-sync", handleRoomSync);
      window.removeEventListener("stream-room-ended", handleRoomEnded);
      window.removeEventListener("p2p-stream-post-received", handleStreamPostReceived);
    };
  }, [state.isStreamingEnabled, dispatch]);

  const activeRoom = state.activeRoomId ? state.roomsById[state.activeRoomId] ?? null : null;

  const value = useMemo<StreamingContextValue>(
    () => ({
      status: state.status,
      isStreamingEnabled: state.isStreamingEnabled,
      activeRoom,
      roomsById: state.roomsById,
      lastError: state.lastError,
      connect,
      disconnect,
      createRoom,
      startRoom: createRoom,
      joinRoom,
      leaveRoom,
      refreshRoom,
      promoteRoomToPost,
      setRoomBroadcastState,
      sendModerationAction: sendModerationActionFn,
      toggleRecording: toggleRecordingFn,
    }),
    [
      state.status,
      state.isStreamingEnabled,
      state.roomsById,
      state.lastError,
      activeRoom,
      connect,
      disconnect,
      createRoom,
      joinRoom,
      leaveRoom,
      refreshRoom,
      promoteRoomToPost,
      setRoomBroadcastState,
      sendModerationActionFn,
      toggleRecordingFn,
    ]
  );

  return <StreamingContext.Provider value={value}>{children}</StreamingContext.Provider>;
}

export function useStreamingContext(): StreamingContextValue {
  const context = useContext(StreamingContext);

  if (!context) {
    throw new Error("useStreamingContext must be used within a StreamingProvider");
  }

  return context;
}
