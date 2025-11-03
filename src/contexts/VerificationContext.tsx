import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { useP2PContext } from "@/contexts/P2PContext";
import { recordP2PDiagnostic } from "@/lib/p2p/diagnostics";

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
  const {
    broadcastVerificationEnvelope,
    setActiveVerificationEnvelope,
    subscribeToVerificationEnvelopes,
    isEnabled: isP2PEnabled,
  } = useP2PContext();
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

  const handleIncomingEnvelope = useCallback(
    async ({ envelope, peerId }: { envelope: VerificationProofEnvelope; peerId: string }) => {
      const user = getCurrentUser();
      if (!user || envelope.payload.userId !== user.id) {
        recordP2PDiagnostic({
          level: "info",
          source: "verification-sync",
          code: "verification-ignored-user",
          message: "Ignoring verification envelope for different user",
          context: { peerId, envelopeUserId: envelope.payload.userId },
        });
        return;
      }

      const isValid = await verifyProof(envelope);
      if (!isValid) {
        recordP2PDiagnostic({
          level: "warn",
          source: "verification-sync",
          code: "verification-invalid",
          message: "Rejected verification envelope with invalid signature",
          context: { peerId },
        });
        import("sonner").then(({ toast }) => {
          toast.error("Rejected verification proof from peer", {
            description: `Signature validation failed for ${peerId}.`,
          });
        });
        return;
      }

      const current = stateRef.current;
      const incomingIssuedAt = Date.parse(envelope.payload.issuedAt);
      if (!Number.isFinite(incomingIssuedAt)) {
        recordP2PDiagnostic({
          level: "warn",
          source: "verification-sync",
          code: "verification-invalid-issued-at",
          message: "Rejected verification envelope with invalid issuedAt",
          context: { peerId, issuedAt: envelope.payload.issuedAt },
        });
        import("sonner").then(({ toast }) => {
          toast.error("Verification proof missing timestamp", {
            description: `Peer ${peerId} sent a malformed proof.`,
          });
        });
        return;
      }

      const currentIssuedRaw = current.activeProof
        ? Date.parse(current.activeProof.payload.issuedAt)
        : Number.NaN;
      const currentIssuedAt = Number.isFinite(currentIssuedRaw)
        ? currentIssuedRaw
        : Number.NEGATIVE_INFINITY;

      if (currentIssuedAt >= incomingIssuedAt) {
        recordP2PDiagnostic({
          level: "info",
          source: "verification-sync",
          code: "verification-stale",
          message: "Ignored stale verification envelope",
          context: {
            peerId,
            incomingIssuedAt: envelope.payload.issuedAt,
            currentIssuedAt: current.activeProof?.payload.issuedAt ?? null,
          },
        });
        import("sonner").then(({ toast }) => {
          toast.warning("Ignored stale verification proof", {
            description: `Existing proof is newer than the one from ${peerId}.`,
          });
        });
        return;
      }

      persistVerificationProof(envelope);
      persistVerificationLegacyOptOut(false);
      persistVerificationCooldown(null);

      const newRecord: VerificationMedalRecord = {
        medal: envelope.payload.medal,
        earnedAt: envelope.payload.issuedAt,
        cardImage: envelope.payload.medalCardImage ?? null,
        entropyScore: envelope.payload.entropyScore,
        totalTimeMs: envelope.payload.totalTimeMs,
      };

      const updatedMedals = [
        newRecord,
        ...current.medalHistory.filter(
          (existing) =>
            existing.earnedAt !== newRecord.earnedAt || existing.medal !== newRecord.medal,
        ),
      ].sort((a, b) => (a.earnedAt < b.earnedAt ? 1 : -1));

      persistVerificationMedals(updatedMedals);

      try {
        await saveVerificationRecord(user.id, envelope);
      } catch (error) {
        console.warn("[Verification] Failed to persist verification record", error);
      }

      setState((previous) => ({
        ...previous,
        requiresVerification: false,
        cooldownUntil: null,
        activeProof: envelope,
        medalHistory: updatedMedals,
      }));

      setActiveVerificationEnvelope(envelope);

      recordP2PDiagnostic({
        level: "info",
        source: "verification-sync",
        code: "verification-updated",
        message: "Updated verification proof from peer",
        context: { peerId, issuedAt: envelope.payload.issuedAt },
      });

      import("sonner").then(({ toast }) => {
        toast.success("Verification proof updated", {
          description: `Applied latest proof shared by ${peerId}.`,
        });
      });
    },
    [setActiveVerificationEnvelope],
  );

  useEffect(() => {
    if (!isP2PEnabled) {
      return;
    }

    return subscribeToVerificationEnvelopes(({ envelope, peerId }) => {
      void handleIncomingEnvelope({ envelope, peerId });
    });
  }, [handleIncomingEnvelope, isP2PEnabled, subscribeToVerificationEnvelopes]);

  useEffect(() => {
    setActiveVerificationEnvelope(state.activeProof ?? null);
  }, [state.activeProof, setActiveVerificationEnvelope]);

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

      setActiveVerificationEnvelope(envelope);
      broadcastVerificationEnvelope(envelope);

      return result;
    },
  [
    state.medalHistory,
    state.lastPromptedAt,
    broadcastVerificationEnvelope,
    setActiveVerificationEnvelope,
  ],
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
      setActiveVerificationEnvelope(envelope);
      return true;
    },
  [setActiveVerificationEnvelope]);

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
