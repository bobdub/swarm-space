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
} from "@/lib/streaming/api";
import type {
  CreateStreamRoomInput,
  JoinStreamRoomOptions,
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
  promoteRoomToPost: (roomId: string) => Promise<void>;
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
  | { type: "remove-room"; roomId: string };

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
    case "upsert-room":
      return {
        ...state,
        roomsById: {
          ...state.roomsById,
          [action.room.id]: action.room,
        },
      };
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

  const dispatch = useCallback(
    (action: StreamingAction) => {
      if (isMountedRef.current) {
        baseDispatch(action);
      }
    },
    [baseDispatch]
  );

  const processSocketPayload = useCallback(
    (payload: StreamingSocketMessage) => {
      switch (payload.type) {
        case "room:update":
          dispatch({ type: "upsert-room", room: payload.room });
          break;
        case "room:ended":
        case "room:deleted":
        case "room:closed":
        case "room:remove":
          dispatch({ type: "remove-room", roomId: payload.roomId });
          break;
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

    dispatch({ type: "set-status", status: "connecting" });

    try {
      const rooms = await fetchActiveStreamRooms();
      dispatch({ type: "set-rooms", rooms });
      dispatch({ type: "set-error", error: null });
    } catch (error) {
      const normalized = normalizeError(error, "Failed to load active stream rooms");
      dispatch({ type: "set-error", error: normalized, status: "error" });
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
  }, [dispatch, processSocketPayload]);

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
        dispatch({ type: "set-error", error: null });
        return room;
      } catch (error) {
        const normalized = normalizeError(error, "Failed to create stream room");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [dispatch]
  );

  const joinRoom = useCallback(
    async (roomId: string, options?: JoinStreamRoomOptions) => {
      try {
        const response = await joinStreamRoom(roomId, options);
        dispatch({ type: "upsert-room", room: response.room });
        dispatch({ type: "set-active-room", roomId: response.room.id });
        dispatch({ type: "set-error", error: null });
      } catch (error) {
        const normalized = normalizeError(error, "Failed to join stream room");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [dispatch]
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
        } else {
          dispatch({ type: "remove-room", roomId: targetRoomId });
        }

        if (activeRoomIdRef.current === targetRoomId) {
          dispatch({ type: "set-active-room", roomId: null });
        }

        dispatch({ type: "set-error", error: null });
      } catch (error) {
        const normalized = normalizeError(error, "Failed to leave stream room");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [dispatch]
  );

  const refreshRoom = useCallback(
    async (roomId: string) => {
      try {
        const room = await fetchStreamRoom(roomId);
        dispatch({ type: "upsert-room", room });
        dispatch({ type: "set-error", error: null });
      } catch (error) {
        const normalized = normalizeError(error, "Failed to refresh stream room");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [dispatch]
  );

  const promoteRoomToPost = useCallback(
    async (roomId: string) => {
      try {
        const response = await promoteStreamRoom(roomId);
        dispatch({ type: "upsert-room", room: response.room });
        dispatch({ type: "set-error", error: null });
      } catch (error) {
        const normalized = normalizeError(error, "Failed to promote stream room");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [dispatch]
  );

  const sendModerationActionFn = useCallback(
    async (roomId: string, action: StreamModerationAction) => {
      try {
        const room = await sendStreamModerationAction(roomId, action);
        dispatch({ type: "upsert-room", room });
        dispatch({ type: "set-error", error: null });
      } catch (error) {
        const normalized = normalizeError(error, "Failed to apply moderation action");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [dispatch]
  );

  const toggleRecordingFn = useCallback(
    async (roomId: string, enabled: boolean) => {
      try {
        const response = await toggleStreamRecording(roomId, enabled);
        dispatch({ type: "upsert-room", room: response.room });
        dispatch({ type: "set-error", error: null });
      } catch (error) {
        const normalized = normalizeError(error, "Failed to toggle recording");
        dispatch({ type: "set-error", error: normalized, status: "error" });
        throw normalized;
      }
    },
    [dispatch]
  );

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
  }, [state.isStreamingEnabled, connect, disconnect]);

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
