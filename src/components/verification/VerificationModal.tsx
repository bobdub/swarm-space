import { useState } from "react";
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
import { generateVerificationProof } from "@/lib/verification/proof";
import { markVerified, markPromptShown } from "@/lib/verification/storage";
import { evaluateAchievementEvent } from "@/lib/achievements";
import { toast } from "sonner";

interface VerificationModalProps {
  open: boolean;
  userId: string;
  isNewUser: boolean;
  onComplete: () => void;
  onSkip?: () => void;
}

const CREDIT_REWARD = 1;

export function VerificationModal({
  open,
  userId,
  isNewUser,
  onComplete,
  onSkip,
}: VerificationModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);

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
    if (onSkip && !isNewUser) {
      await markPromptShown(userId);
      onSkip();
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-2xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-display uppercase tracking-[0.2em]">
            {isNewUser ? "Human Verification" : "Help Us Test Verification"}
          </DialogTitle>
          <DialogDescription>
            {isNewUser
              ? "Match the pairs to verify you're human and unlock your first medal."
              : "Try our verification game and earn a medal! You can skip this and try again later."}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <DreamMatchGame
            onComplete={handleGameComplete}
            onSkip={!isNewUser ? handleSkip : undefined}
            showSkipOption={!isNewUser}
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
      </DialogContent>
    </Dialog>
  );
}
