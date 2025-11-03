import {
  ONBOARDING_STORAGE_KEYS,
} from "@/lib/onboarding/constants";
import type {
  VerificationMedalRecord,
  VerificationProofEnvelope,
  VerificationStateSnapshot,
} from "@/types/verification";

function parseJSON<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn("[Verification] Failed to parse JSON", error);
    return null;
  }
}

export function loadVerificationStateFromStorage(): VerificationStateSnapshot {
  if (typeof window === "undefined") {
    return {
      requiresVerification: true,
      cooldownUntil: null,
      lastPromptedAt: null,
      activeProof: null,
      medalHistory: [],
    };
  }

  const manifestId = window.localStorage.getItem(
    ONBOARDING_STORAGE_KEYS.verificationProofManifest,
  );
  const signature = window.localStorage.getItem(
    ONBOARDING_STORAGE_KEYS.verificationProofSignature,
  );
  const proofPayload = parseJSON<VerificationProofEnvelope["payload"]>(
    window.localStorage.getItem("flux_verification_proof_payload"),
  );
  const publicKey = window.localStorage.getItem("flux_verification_proof_public_key");
  const signedAt = window.localStorage.getItem("flux_verification_proof_signed_at");

  const cooldownUntil = window.localStorage.getItem(
    ONBOARDING_STORAGE_KEYS.verificationCooldownUntil,
  );
  const lastPromptedAt = window.localStorage.getItem(
    ONBOARDING_STORAGE_KEYS.verificationPromptedAt,
  );
  const medalHistory =
    parseJSON<VerificationMedalRecord[]>(
      window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.verificationMedalHistory),
    ) ?? [];
  const legacyOptOut =
    window.localStorage.getItem(ONBOARDING_STORAGE_KEYS.verificationLegacyOptOut) === "true";

  const hasProof = Boolean(manifestId && signature && proofPayload && publicKey && signedAt);
  const activeProof = hasProof
    ? {
        manifestId: manifestId!,
        signature: signature!,
        publicKey: publicKey!,
        payload: proofPayload!,
        signedAt: signedAt!,
      }
    : null;

  return {
    requiresVerification: legacyOptOut ? false : !hasProof,
    cooldownUntil,
    lastPromptedAt,
    activeProof,
    medalHistory,
  };
}

export function persistVerificationProof(envelope: VerificationProofEnvelope) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    ONBOARDING_STORAGE_KEYS.verificationProofManifest,
    envelope.manifestId,
  );
  window.localStorage.setItem(
    ONBOARDING_STORAGE_KEYS.verificationProofSignature,
    envelope.signature,
  );
  window.localStorage.setItem(
    "flux_verification_proof_payload",
    JSON.stringify(envelope.payload),
  );
  window.localStorage.setItem(
    "flux_verification_proof_public_key",
    envelope.publicKey,
  );
  window.localStorage.setItem("flux_verification_proof_signed_at", envelope.signedAt);
}

export function persistVerificationMedals(records: VerificationMedalRecord[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    ONBOARDING_STORAGE_KEYS.verificationMedalHistory,
    JSON.stringify(records),
  );
}

export function persistVerificationCooldown(until: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (until) {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.verificationCooldownUntil, until);
  } else {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEYS.verificationCooldownUntil);
  }
}

export function persistVerificationPrompted(timestamp: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.verificationPromptedAt, timestamp);
}

export function persistVerificationLegacyOptOut(value: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  if (value) {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEYS.verificationLegacyOptOut, "true");
  } else {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEYS.verificationLegacyOptOut);
  }
}
