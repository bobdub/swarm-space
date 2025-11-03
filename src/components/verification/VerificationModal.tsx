import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import DreamMatchGame from "./DreamMatchGame";
import type { VerificationSessionResult } from "@/types/verification";
import { selectHighestPriorityMedal } from "@/lib/verification/medals";

interface VerificationModalProps {
  open: boolean;
  mode: "required" | "optional";
  onClose: () => void;
  onSkip?: () => void;
  onComplete: (
    result: Omit<VerificationSessionResult, "issuedAt" | "creditsAwarded"> & {
      issuedAt?: string;
      creditsAwarded?: number;
    },
  ) => Promise<VerificationSessionResult | null>;
}

const MEDAL_LABELS: Record<string, string> = {
  Dream_Matcher: "Dream Matcher 🧩",
  Last_Reflection: "Last Reflection 🪞",
  Patience_Protocol: "Patience Protocol ⏳",
  Irony_Chip: "Irony Chip 🤖",
};

const formatTime = (totalMs: number) => {
  const seconds = Math.round(totalMs / 1000);
  return `${seconds}s`;
};

const VerificationModal = ({
  open,
  mode,
  onClose,
  onSkip,
  onComplete,
}: VerificationModalProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationSessionResult | null>(null);
  const [gameKey, setGameKey] = useState(0);

  const handleGameComplete = useCallback(
    async (metrics: VerificationSessionResult["metrics"], repeatedCardImage?: string | null) => {
      setIsSubmitting(true);
      setError(null);
      try {
        const verification = await onComplete({ metrics, cardImage: repeatedCardImage ?? null });
        if (verification) {
          setResult(verification);
        } else {
          setError("Verification failed. Please try again.");
          setGameKey((previous) => previous + 1);
        }
      } catch (err) {
        console.error("[Verification] Failed to finalize", err);
        setError("Something went wrong while saving your proof. Please retry.");
        setGameKey((previous) => previous + 1);
      } finally {
        setIsSubmitting(false);
      }
    },
    [onComplete],
  );

  const handleFailure = useCallback(() => {
    setError("Time expired. Try again.");
    setGameKey((previous) => previous + 1);
  }, []);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
      setIsSubmitting(false);
      setGameKey((previous) => previous + 1);
    }
  }, [open]);

  const modalTitle = useMemo(() => {
    if (result) {
      return "Verification Complete";
    }
    return mode === "required" ? "Verify your humanity" : "Help us test Dream Match";
  }, [mode, result]);

  const highestMedal = useMemo(() => {
    if (!result) {
      return null;
    }
    return selectHighestPriorityMedal([result.medal]);
  }, [result]);

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next && mode === "required" && !result) {
        return;
      }
      if (!next) {
        onClose();
      }
    }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{modalTitle}</DialogTitle>
          {mode === "optional" && !result ? (
            <DialogDescription>
              Play a quick Dream Match to earn a medal and a bonus credit. You can also skip and come back
              later.
            </DialogDescription>
          ) : null}
          {mode === "required" && !result ? (
            <DialogDescription>
              Complete Dream Match to unlock the network. We use gameplay entropy to keep bots out while
              staying privacy-first.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {result ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">
                Medal earned:
              </p>
              <p className="text-xl font-semibold">
                {highestMedal ? MEDAL_LABELS[highestMedal] ?? highestMedal : result.medal}
              </p>
              {result.cardImage ? (
                <p className="text-3xl" aria-label="Repeated card">
                  {result.cardImage}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
              <div>
                <p>Time</p>
                <p className="font-medium text-foreground">{formatTime(result.metrics.totalTimeMs)}</p>
              </div>
              <div>
                <p>Entropy score</p>
                <p className="font-medium text-foreground">
                  {result.metrics.entropyScore.toFixed(2)}
                </p>
              </div>
              <div>
                <p>Accuracy</p>
                <p className="font-medium text-foreground">
                  {(result.metrics.accuracy * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <p>Moves</p>
                <p className="font-medium text-foreground">{result.metrics.moveCount}</p>
              </div>
            </div>
          </div>
        ) : (
          <DreamMatchGame
            key={gameKey}
            onComplete={handleGameComplete}
            onFailure={handleFailure}
          />
        )}
        <DialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          {error ? <p className="text-sm text-destructive">{error}</p> : <span />}
          <div className="flex flex-row gap-2">
            {mode === "optional" && !result ? (
              <Button variant="ghost" onClick={() => {
                if (onSkip) {
                  onSkip();
                }
                onClose();
              }}>
                Later
              </Button>
            ) : null}
            {result ? (
              <Button onClick={onClose}>Continue</Button>
            ) : (
              <Button disabled>{isSubmitting ? "Saving proof..." : "Match the cards"}</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VerificationModal;
