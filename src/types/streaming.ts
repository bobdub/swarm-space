export type StreamVisibility = "public" | "followers" | "invite-only";

export type StreamParticipantRole =
  | "host"
  | "cohost"
  | "speaker"
  | "listener";

export interface StreamParticipant {
  peerId: string;
  userId: string;
  handle: string;
  role: StreamParticipantRole;
  audioMuted: boolean;
  videoMuted: boolean;
  joinedAt: string;
  lastHeartbeatAt: string;
  connection: "direct" | "turn";
}

export interface StreamInvite {
  token: string;
  handle?: string;
  role: StreamParticipantRole;
  createdAt: string;
  expiresAt: string | null;
  revokedAt?: string | null;
}

export interface StreamRecordingState {
  status: "off" | "starting" | "recording" | "stopping" | "failed";
  recordingId?: string;
  retainUntil?: string | null;
  failureReason?: string | null;
}

export interface StreamSummary {
  summaryId: string;
  language: string;
  bullets: string[];
  generatedAt: string;
}

export interface StreamRoom {
  id: string;
  title: string;
  context: "profile" | "project";
  projectId?: string;
  visibility: StreamVisibility;
  state: "idle" | "live" | "ended";
  hostPeerId: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  participants: StreamParticipant[];
  invites: StreamInvite[];
  recording?: StreamRecordingState;
  summary?: StreamSummary;
  turnRelays?: string[];
}

export interface CreateStreamRoomInput {
  context: "profile" | "project";
  projectId?: string;
  title: string;
  visibility: StreamVisibility;
  invitees?: Array<{ handle: string; role: StreamParticipantRole }>;
}

export interface JoinStreamRoomOptions {
  invitationToken?: string;
}

export type StreamModerationAction =
  | {
      type: "mute" | "unmute";
      peerId: string;
      scope: "audio" | "video" | "both";
    }
  | {
      type: "ban" | "remove";
      peerId: string;
      durationSeconds?: number;
    }
  | {
      type: "promote" | "demote";
      peerId: string;
      role: StreamParticipantRole;
    };
