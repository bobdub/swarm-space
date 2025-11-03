import type { VerificationState, VerificationProof } from "./types";
import { put, get } from "@/lib/store";

const VERIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get verification state from storage
 */
export async function getVerificationState(userId: string): Promise<VerificationState> {
  const defaultState: VerificationState = {
    verified: false,
    verifiedAt: null,
    medal: null,
    promptShown: false,
    promptShownAt: null,
    attempts: 0,
  };

  try {
    const stored = await get("verificationStates", userId);
    return stored as VerificationState || defaultState;
  } catch {
    return defaultState;
  }
}

/**
 * Save verification state to storage
 */
export async function saveVerificationState(
  userId: string,
  state: VerificationState
): Promise<void> {
  try {
    await put("verificationStates", {
      id: userId,
      ...state,
    });
  } catch (error) {
    console.error("[Verification] Failed to save state:", error);
  }
}

export async function recordVerificationAttempt(userId: string): Promise<VerificationState> {
  const state = await getVerificationState(userId);
  const updated: VerificationState = {
    ...state,
    attempts: state.attempts + 1,
  };

  await saveVerificationState(userId, updated);
  return updated;
}

/**
 * Check if user can be prompted for verification (cooldown check)
 */
export function canPromptVerification(state: VerificationState): boolean {
  if (state.verified) {
    return false; // Already verified
  }

  if (!state.promptShown) {
    return true; // Never prompted
  }

  if (!state.promptShownAt) {
    return true; // No timestamp
  }

  const lastPromptTime = new Date(state.promptShownAt).getTime();
  const now = Date.now();
  const timeSincePrompt = now - lastPromptTime;

  return timeSincePrompt >= VERIFICATION_COOLDOWN_MS;
}

/**
 * Mark verification prompt as shown
 */
export async function markPromptShown(userId: string): Promise<void> {
  const state = await getVerificationState(userId);
  await saveVerificationState(userId, {
    ...state,
    promptShown: true,
    promptShownAt: new Date().toISOString(),
  });
}

/**
 * Mark user as verified
 */
export async function markVerified(
  userId: string,
  proof: VerificationProof,
  options?: { attempts?: number }
): Promise<void> {
  const state = await getVerificationState(userId);
  const attempts = options?.attempts ?? state.attempts + 1;
  await saveVerificationState(userId, {
    ...state,
    verified: true,
    verifiedAt: proof.timestamp,
    medal: proof.medal,
    attempts,
  });

  // Store proof
  try {
    await put("verificationProofs", proof);
  } catch (error) {
    console.error("[Verification] Failed to store proof:", error);
  }
}

/**
 * Get verification proof for user
 */
export async function getVerificationProof(userId: string): Promise<VerificationProof | null> {
  try {
    const proof = await get("verificationProofs", userId);
    return proof as VerificationProof || null;
  } catch {
    return null;
  }
}
