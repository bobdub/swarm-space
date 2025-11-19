const normalizeBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
};

export const STREAMING_FEATURE_ENABLED = normalizeBoolean(
  import.meta.env?.VITE_STREAMING_ENABLED,
  Boolean(import.meta.env?.DEV),
);

export const STREAMING_SOCKET_URL = import.meta.env?.VITE_STREAMING_SOCKET_URL ?? "/api/signaling/ws";
export const STREAMING_API_BASE_URL = import.meta.env?.VITE_STREAMING_API_BASE_URL as string | undefined;
export const STREAMING_SIGNALING_BASE_PATH = "/api/signaling";
export const STREAMING_STREAMS_BASE_PATH = "/api/streams";

const STREAMING_USE_MOCK_ENV = import.meta.env?.VITE_STREAMING_USE_MOCK;
export const STREAMING_API_MOCK_ENABLED = normalizeBoolean(STREAMING_USE_MOCK_ENV, Boolean(import.meta.env?.DEV));
