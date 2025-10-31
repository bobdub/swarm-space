/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  type ReactNode,
  useMemo,
} from "react";
import type {
  CreateStreamRoomInput,
  JoinStreamRoomOptions,
  StreamModerationAction,
  StreamRoom,
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

const StreamingContext = createContext<StreamingContextValue | null>(null);

function createOfflineStreamingState(): StreamingContextValue {
  return {
    status: "idle",
    isStreamingEnabled: false,
    activeRoom: null,
    roomsById: {},
    lastError: null,
    connect: async () => {},
    disconnect: () => {},
    createRoom: async () => {
      throw new Error("Streaming is not enabled");
    },
    joinRoom: async () => {
      throw new Error("Streaming is not enabled");
    },
    leaveRoom: async () => {},
    refreshRoom: async () => {},
    promoteRoomToPost: async () => {
      throw new Error("Streaming is not enabled");
    },
    sendModerationAction: async () => {
      throw new Error("Streaming is not enabled");
    },
    toggleRecording: async () => {
      throw new Error("Streaming is not enabled");
    },
  };
}

export function StreamingProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  // Milestone 1 will replace this placeholder with live wiring into the
  // signaling REST + WebSocket services. For now we expose an offline state
  // so downstream components can begin consuming the API.
  const value = useMemo(() => createOfflineStreamingState(), []);

  return (
    <StreamingContext.Provider value={value}>
      {children}
    </StreamingContext.Provider>
  );
}

export function useStreamingContext(): StreamingContextValue {
  const context = useContext(StreamingContext);

  if (!context) {
    throw new Error("useStreamingContext must be used within a StreamingProvider");
  }

  return context;
}
