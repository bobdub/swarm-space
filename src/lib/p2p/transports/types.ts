export type TransportStateValue = 'idle' | 'initializing' | 'ready' | 'active' | 'degraded' | 'error';

export interface TransportRuntimeStatus {
  state: TransportStateValue;
  lastError: string | null;
}

export type TransportMessageHandler = (peerId: string, payload: unknown) => void;
export type TransportPeerListener = (peerIds: string[]) => void;
export type TransportStatusListener = (status: TransportRuntimeStatus) => void;
