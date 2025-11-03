import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { awardVerificationCredits, CREDIT_REWARDS } from "@/lib/credits";
import { getCurrentUser } from "@/lib/auth";
import { createVerificationProof, verifyProof } from "@/lib/verification/proof";
import {
  loadVerificationStateFromStorage,
  persistVerificationCooldown,
  persistVerificationMedals,
  persistVerificationProof,
  persistVerificationPrompted,
  persistVerificationLegacyOptOut,
} from "@/lib/verification/storage";
import { saveVerificationRecord } from "@/lib/verification/repository";
import type {
  VerificationMedalRecord,
  VerificationProofEnvelope,
  VerificationSessionResult,
  VerificationStateSnapshot,
} from "@/types/verification";
import { assignMedal } from "@/lib/verification/medals";

const LEGACY_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface VerificationContextValue extends VerificationStateSnapshot {
  startLegacyPrompt: () => void;
  recordPromptShown: () => void;
  completeVerification: (
    result: Omit<VerificationSessionResult, "issuedAt" | "creditsAwarded"> & {
      issuedAt?: string;
      creditsAwarded?: number;
    },
  ) => Promise<VerificationSessionResult | null>;
  skipForLegacy: () => void;
  refreshProof: (envelope: VerificationProofEnvelope) => Promise<boolean>;
}

const VerificationContext = createContext<VerificationContextValue | null>(null);

function coerceTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

export function VerificationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VerificationStateSnapshot>(() =>
    loadVerificationStateFromStorage(),
  );

  useEffect(() => {
    setState((previous) => ({
      ...previous,
      cooldownUntil: coerceTimestamp(previous.cooldownUntil),
      lastPromptedAt: coerceTimestamp(previous.lastPromptedAt),
    }));
  }, []);

  const recordPromptShown = useCallback(() => {
    const timestamp = new Date().toISOString();
    persistVerificationPrompted(timestamp);
    const cooldown = new Date(Date.now() + LEGACY_PROMPT_COOLDOWN_MS).toISOString();
    persistVerificationCooldown(cooldown);
    setState((previous) => ({
      ...previous,
      lastPromptedAt: timestamp,
      cooldownUntil: cooldown,
    }));
  }, []);

  const skipForLegacy = useCallback(() => {
    recordPromptShown();
    persistVerificationLegacyOptOut(true);
    setState((previous) => ({
      ...previous,
      requiresVerification: false,
    }));
  }, [recordPromptShown]);

  const startLegacyPrompt = useCallback(() => {
    const timestamp = new Date().toISOString();
    persistVerificationPrompted(timestamp);
    setState((previous) => ({
      ...previous,
      lastPromptedAt: timestamp,
    }));
  }, []);

  const completeVerification = useCallback<VerificationContextValue["completeVerification"]>(
    async (resultInput) => {
      const user = getCurrentUser();
      if (!user) {
        console.warn("[Verification] No user found; cannot complete verification");
        return null;
      }

      const issuedAt = resultInput.issuedAt ?? new Date().toISOString();
      const creditsAwarded =
        resultInput.creditsAwarded ?? CREDIT_REWARDS.VERIFICATION_COMPLETION;
      const baseMetrics = resultInput.metrics;
      const medalDecision = assignMedal(baseMetrics, resultInput.cardImage);

      if (!medalDecision.medal) {
        console.warn("[Verification] Metrics did not meet verification threshold");
        return null;
      }

      const result: VerificationSessionResult = {
        medal: medalDecision.medal,
        cardImage: medalDecision.cardImage ?? resultInput.cardImage ?? null,
        metrics: baseMetrics,
        issuedAt,
        creditsAwarded,
      };

      const envelope = await createVerificationProof(result, user.id);
      persistVerificationProof(envelope);
      persistVerificationLegacyOptOut(false);
      try {
        await saveVerificationRecord(user.id, envelope);
      } catch (error) {
        console.warn("[Verification] Failed to persist verification record", error);
      }

      const updatedMedals: VerificationMedalRecord[] = [
        {
          medal: result.medal,
          earnedAt: issuedAt,
          cardImage: result.cardImage ?? null,
          entropyScore: result.metrics.entropyScore,
          totalTimeMs: result.metrics.totalTimeMs,
        },
        ...state.medalHistory,
      ].sort((a, b) => (a.earnedAt < b.earnedAt ? 1 : -1));

      persistVerificationMedals(updatedMedals);
      persistVerificationCooldown(null);

      try {
        await awardVerificationCredits(user.id);
      } catch (error) {
        console.warn("[Verification] Failed to award credits", error);
      }

      setState({
        requiresVerification: false,
        cooldownUntil: null,
        lastPromptedAt: state.lastPromptedAt,
        activeProof: envelope,
        medalHistory: updatedMedals,
      });

      return result;
    },
  [state.medalHistory, state.lastPromptedAt],
  );

  const refreshProof = useCallback<VerificationContextValue["refreshProof"]>(
    async (envelope) => {
      const valid = await verifyProof(envelope);
      if (!valid) {
        return false;
      }
      persistVerificationProof(envelope);
      persistVerificationLegacyOptOut(false);
      try {
        await saveVerificationRecord(envelope.payload.userId, envelope);
      } catch (error) {
        console.warn("[Verification] Failed to persist verification record", error);
      }
      setState((previous) => ({
        ...previous,
        activeProof: envelope,
        requiresVerification: false,
      }));
      return true;
    },
  []);

  const value = useMemo<VerificationContextValue>(
    () => ({
      ...state,
      startLegacyPrompt,
      recordPromptShown,
      completeVerification,
      skipForLegacy,
      refreshProof,
    }),
    [state, startLegacyPrompt, recordPromptShown, completeVerification, skipForLegacy, refreshProof],
  );

  return (
    <VerificationContext.Provider value={value}>
      {children}
    </VerificationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useVerification(): VerificationContextValue {
  const context = useContext(VerificationContext);
  if (!context) {
    throw new Error("useVerification must be used within a VerificationProvider");
  }
  return context;
}
