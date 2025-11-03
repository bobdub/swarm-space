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
import { calculateOverallEntropy } from "@/lib/verification/entropy";
import { awardMedal, getMedalInfo } from "@/lib/verification/medals";
import { generateVerificationProof, verifyVerificationProof } from "@/lib/verification/proof";
import { markVerified, markPromptShown, recordVerificationAttempt } from "@/lib/verification/storage";
import { evaluateAchievementEvent } from "@/lib/achievements";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface VerificationModalProps {
  open: boolean;
  userId: string;
  isNewUser: boolean;
  onComplete: () => void;
  onSkip?: () => void;
  sandbox?: boolean;
}

const CREDIT_REWARD = 1;

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
  const [gameKey, setGameKey] = useState(0);

  const restartGame = useCallback(() => {
    setGameKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!open) {
      setRetryContext(null);
      setIsProcessing(false);
    }
  }, [open]);

  const handleGameComplete = async (metrics: VerificationMetrics) => {
    setIsProcessing(true);

    try {
      // Calculate entropy
      const entropy = calculateOverallEntropy(metrics);
      const enrichedMetrics = { ...metrics, entropy };

      // Check minimum entropy threshold
      if (entropy < 0.3) {
        toast.error("Verification failed", {
          description: "Please try again with more natural movements.",
        });
        restartGame();
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
        const attemptState = await recordVerificationAttempt(userId);
        setRetryContext({ attempts: attemptState.attempts });
        restartGame();
        setIsProcessing(false);

        toast.error("Verification failed", {
          description: "Signature mismatch detected. Please retry.",
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
      toast.error("Failed to save verification", {
        description: "Please try again.",
      });
    } finally {
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

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-2xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-display uppercase tracking-[0.2em]">
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <DreamMatchGame
            key={gameKey}
            onComplete={handleGameComplete}
            onSkip={showSkipButton ? handleSkip : undefined}
            showSkipOption={showSkipButton}
            skipLabel={sandbox ? "Close practice" : undefined}
          />
        </div>

        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="text-center space-y-2">
              <div className="animate-spin text-4xl">✨</div>
              <p className="text-sm text-muted-foreground">Verifying...</p>
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
