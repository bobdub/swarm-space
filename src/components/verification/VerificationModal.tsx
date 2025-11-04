import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DreamMatchGame } from "./DreamMatchGame";
import type { VerificationMetrics } from "@/lib/verification/types";
import { calculateEntropyBreakdown } from "@/lib/verification/entropy";
import { awardMedal, getMedalInfo } from "@/lib/verification/medals";
import { generateVerificationProof, verifyVerificationProof } from "@/lib/verification/proof";
import { markVerified, markPromptShown, recordVerificationAttempt } from "@/lib/verification/storage";
import { evaluateAchievementEvent } from "@/lib/achievements";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type FailureContext = {
  reason: "low-entropy";
  breakdown: {
    overall: number;
    mouseEntropy: number;
    clickEntropy: number;
    flipsTotal: number;
    completionTime: number;
  };
};

interface VerificationModalProps {
  open: boolean;
  userId: string;
  isNewUser: boolean;
  onComplete: () => void;
  onSkip?: () => void;
  sandbox?: boolean;
}

const CREDIT_REWARD = 1;
const MINIMUM_ENTROPY = 0.15;

export function VerificationModal({
  open,
  userId,
  isNewUser,
  onComplete,
  onSkip,
  sandbox = false,
}: VerificationModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [retryContext, setRetryContext] = useState<{ attempts: number } | null>(null);
  const [failureContext, setFailureContext] = useState<FailureContext | null>(null);
  const [gameKey, setGameKey] = useState(0);

  // Debug logging
  console.log('[VerificationModal] Render:', { open, userId, isNewUser, isProcessing });

  const restartGame = useCallback(() => {
    setGameKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!open) {
      setRetryContext(null);
      setIsProcessing(false);
      setFailureContext(null);
    }
  }, [open]);

  const handleGameComplete = async (metrics: VerificationMetrics) => {
    setFailureContext(null);
    setRetryContext(null);
    setIsProcessing(true);

    try {
      // Calculate entropy breakdown
      const breakdown = calculateEntropyBreakdown(metrics);
      const entropy = breakdown.overall;
      const enrichedMetrics = { ...metrics, entropy };

      // Check minimum entropy threshold
      if (entropy < MINIMUM_ENTROPY) {
        console.warn('[Verification] Low entropy detected:', entropy);
        setFailureContext({
          reason: "low-entropy",
          breakdown: {
            overall: entropy,
            mouseEntropy: breakdown.mouseEntropy,
            clickEntropy: breakdown.clickEntropy,
            flipsTotal: metrics.flipsTotal,
            completionTime: metrics.completionTime,
          },
        });
        setIsProcessing(false);
        return;
      }

      if (sandbox) {
        toast.success("Practice complete!", {
          description: "Dream Match stats reset without affecting credits or medals.",
        });
        restartGame();
        setIsProcessing(false);
        return;
      }

      // Determine medal
      const { medal } = awardMedal(enrichedMetrics);
      const medalInfo = getMedalInfo(medal);

      // Generate proof
      const proof = await generateVerificationProof({
        userId,
        medal,
        metrics: enrichedMetrics,
        creditsEarned: CREDIT_REWARD,
      });

      const isProofValid = await verifyVerificationProof(proof);

      if (!isProofValid) {
        console.error('[Verification] Proof validation failed');
        const attemptState = await recordVerificationAttempt(userId);
        setRetryContext({ attempts: attemptState.attempts });
        restartGame();
        setIsProcessing(false);

        // Single error toast, no repeats
        toast.error("Verification failed", {
          description: "Signature mismatch detected. Please retry.",
          duration: 5000,
        });

        if (attemptState.attempts >= 3) {
          console.warn(
            `[Verification] Signature mismatches recorded ${attemptState.attempts} times for user ${userId}`
          );
        }

        return;
      }

      // Save verification state
      await markVerified(userId, proof);

      // Award achievement (will be synced via P2P)
      await evaluateAchievementEvent({
        type: "credits:earned",
        userId,
        amount: CREDIT_REWARD,
        source: `verification:${medal}`,
        meta: {
          medal,
          entropy,
          completionTime: metrics.completionTime,
        },
      });

      // Show success toast
      toast.success(`${medalInfo.icon} ${medalInfo.title} Unlocked!`, {
        description: `${medalInfo.description} • +${CREDIT_REWARD} credit`,
        duration: 6000,
      });

      onComplete();
    } catch (error) {
      console.error("[Verification] Error processing completion:", error);
      // Single error toast, no repeats
      toast.error("Failed to save verification", {
        description: "Please try again.",
        duration: 5000,
      });
      setIsProcessing(false);
    }
  };

  const handleSkip = async () => {
    if (!onSkip) {
      return;
    }

    if (!isNewUser && !sandbox) {
      await markPromptShown(userId);
    }

    onSkip();
  };

  const title = sandbox
    ? "Practice Dream Match"
    : isNewUser
      ? "Human Verification"
      : "Help Us Test Verification";

  const description = sandbox
    ? "Run Dream Match in sandbox mode to get a feel for the flow without earning medals or credits."
    : isNewUser
      ? "Match the pairs to verify you're human and unlock your first medal."
      : "Try our verification game and earn a medal! You can skip this and try again later.";

  const showSkipButton = sandbox || !isNewUser;
  const skipLabel = sandbox ? "Close practice" : "Skip for now";

  const renderEntropySuggestions = () => {
    if (!failureContext) {
      return null;
    }

    const suggestions: string[] = [];

    if (failureContext.breakdown.mouseEntropy < 0.35) {
      suggestions.push("Move your cursor in gentle arcs and pauses while searching for pairs.");
    }

    if (failureContext.breakdown.clickEntropy < 0.35) {
      suggestions.push("Vary the timing between flips—take a beat after revealing the first card.");
    }

    if (suggestions.length === 0) {
      suggestions.push("Explore the board a little longer before finishing to provide more signal.");
    }

    if (suggestions.length === 1) {
      suggestions.push("Avoid dragging in perfectly straight lines; small corrections help confirm you're human.");
    }

    return (
      <ul className="list-disc space-y-2 pl-5 text-left text-sm text-muted-foreground">
        {suggestions.map((suggestion) => (
          <li key={suggestion}>{suggestion}</li>
        ))}
      </ul>
    );
  };

  return (
    <Dialog open={open} onOpenChange={() => {
      console.log('[VerificationModal] onOpenChange called but ignored');
    }}>
      <DialogContent
        className="relative max-w-2xl sm:max-w-3xl max-h-[90vh] grid-rows-[auto,1fr,auto] overflow-hidden pointer-events-auto"
        onOpenAutoFocus={(event) => {
          console.log('[VerificationModal] onOpenAutoFocus');
          event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          console.log('[VerificationModal] onPointerDownOutside');
          event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          console.log('[VerificationModal] onEscapeKeyDown');
          event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-display uppercase tracking-[0.2em]">
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto pointer-events-auto">
          <div className="py-4 pr-1">
          <DreamMatchGame
            key={gameKey}
            onComplete={handleGameComplete}
            onSkip={undefined}
            showSkipOption={false}
            skipLabel={undefined}
          />
          </div>
        </div>

        {showSkipButton && onSkip && (
          <div className="flex justify-center pb-2">
            <Button
              variant="ghost"
              onClick={() => {
                void handleSkip();
              }}
              className="text-sm font-normal min-h-[44px] px-6"
            >
              {skipLabel}
            </Button>
          </div>
        )}

        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="text-center space-y-2">
              <div className="animate-spin text-4xl">✨</div>
              <p className="text-sm text-muted-foreground">Verifying...</p>
            </div>
          </div>
        )}

        {failureContext && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur">
            <div className="w-full max-w-lg space-y-5 rounded-3xl border border-border bg-card/70 p-6 text-center shadow-xl">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Movements looked automated</h3>
                <p className="text-sm text-muted-foreground">
                  We need a little more natural variation before we can award your medal.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border/60 bg-background/60 p-4 text-left text-xs">
                <div>
                  <p className="font-medium text-muted-foreground/80">Overall signal</p>
                  <p className="text-base font-semibold">
                    {Math.round(failureContext.breakdown.overall * 100)} / 100
                  </p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground/80">Mouse entropy</p>
                  <p className="text-base font-semibold">
                    {Math.round(failureContext.breakdown.mouseEntropy * 100)} / 100
                  </p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground/80">Click entropy</p>
                  <p className="text-base font-semibold">
                    {Math.round(failureContext.breakdown.clickEntropy * 100)} / 100
                  </p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground/80">Flips completed</p>
                  <p className="text-base font-semibold">{failureContext.breakdown.flipsTotal}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground/80">Time spent</p>
                  <p className="text-base font-semibold">
                    {Math.max(1, Math.round(failureContext.breakdown.completionTime / 1000))}s
                  </p>
                </div>
              </div>

              {renderEntropySuggestions()}

              <div className="space-y-2">
                <Button
                  className="w-full"
                  onClick={() => {
                    setFailureContext(null);
                    restartGame();
                  }}
                >
                  Try again
                </Button>
                {showSkipButton && onSkip && (
                  <Button
                    variant="ghost"
                    className="w-full text-sm font-normal"
                    onClick={() => {
                      setFailureContext(null);
                      void handleSkip();
                    }}
                  >
                    {skipLabel}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {retryContext && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur">
            <div className="w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card/60 p-6 text-center shadow-lg">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Signature mismatch detected</h3>
                <p className="text-sm text-muted-foreground">
                  We couldn&apos;t verify the proof this round. Attempts recorded: {retryContext.attempts}.
                </p>
              </div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>No progress was saved. We&apos;ve logged the retry for telemetry.</p>
              </div>
              <Button className="w-full" onClick={() => {
                setRetryContext(null);
                restartGame();
              }}>
                Retry verification
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
