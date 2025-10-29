export const FLUX_TOS_VERSION = "2025-03-01";

export const ONBOARDING_STORAGE_KEYS = {
  tosAccepted: "flux_tos_accepted",
  tosAcceptedAt: "flux_tos_accepted_at",
  tosVersion: "flux_tos_version",
  walkthroughDone: "flux_walkthrough_done",
  walkthroughProgress: "flux_walkthrough_progress",
} as const;

export const SCROLL_GUARD_BUFFER_PX = 24;

export const WALKTHROUGH_STEPS = [
  "welcome",
  "mesh",
  "projects",
  "credits",
  "done",
] as const;

export type WalkthroughStep = (typeof WALKTHROUGH_STEPS)[number];
