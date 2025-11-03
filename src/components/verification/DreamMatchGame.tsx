import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { MemoryCard, VerificationMetrics } from "@/lib/verification/types";
import { cn } from "@/lib/utils";

interface DreamMatchGameProps {
  onComplete: (metrics: VerificationMetrics) => void;
  onSkip?: () => void;
  showSkipOption?: boolean;
  skipLabel?: string;
}

const GAME_DURATION_MS = 150000; // 150 seconds
const CARD_FLIP_DELAY = 2500; // 2.5 seconds to view mismatched cards

const CARD_ICONS = ["🌙", "✨", "🌟", "💫", "🔮", "🎭"];

function shuffleCards(): MemoryCard[] {
  const pairs = CARD_ICONS.slice(0, 3);
  const cards: MemoryCard[] = [];
  
  pairs.forEach((icon, index) => {
    cards.push(
      { id: index * 2, value: icon, icon, flipped: false, matched: false },
      { id: index * 2 + 1, value: icon, icon, flipped: false, matched: false }
    );
  });

  // Fisher-Yates shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards;
}

export function DreamMatchGame({ onComplete, onSkip, showSkipOption, skipLabel }: DreamMatchGameProps) {
  const [cards, setCards] = useState<MemoryCard[]>(() => shuffleCards());
  const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
  const [timeRemaining, setTimeRemaining] = useState(GAME_DURATION_MS);
  const [flipsTotal, setFlipsTotal] = useState(0);
  const [cardFlipCounts, setCardFlipCounts] = useState<Record<number, number>>({});
  const startTimeRef = useRef<number>(Date.now());
  const highResStartRef = useRef<number>(typeof performance !== "undefined" ? performance.now() : Date.now());
  const countdownFrameRef = useRef<number | null>(null);
  const lastCountdownUpdateRef = useRef<number>(0);
  const mouseMovementsRef = useRef<Array<{ x: number; y: number; timestamp: number }>>([]);
  const lastMouseMovementRef = useRef<{ x: number; y: number; timestamp: number } | null>(null);
  const pendingMouseSampleRef = useRef<{ x: number; y: number; timestamp: number } | null>(null);
  const mouseSampleFrameRef = useRef<number | null>(null);
  const clickTimingsRef = useRef<number[]>([]);
  const hasCompletedRef = useRef(false);
  const mismatchTimeoutsRef = useRef<number[]>([]);

  // Track mouse movements
  const flushPendingMouseSample = useCallback(() => {
    const pending = pendingMouseSampleRef.current;
    mouseSampleFrameRef.current = null;

    if (!pending) {
      return;
    }

    const last = lastMouseMovementRef.current;
    if (last) {
      const dx = pending.x - last.x;
      const dy = pending.y - last.y;
      const dt = pending.timestamp - last.timestamp;

      if (dt <= 0) {
        return;
      }

      if (dx === 0 && dy === 0 && dt < 16) {
        return; // Skip zero-length vectors sampled within the same frame
      }

      if (dt <= 4) {
        return; // Ignore ultra-jittery sampling caused by rapid firing handlers
      }
    }

    mouseMovementsRef.current = [...mouseMovementsRef.current.slice(-511), pending];
    lastMouseMovementRef.current = pending;
    pendingMouseSampleRef.current = null;
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    pendingMouseSampleRef.current = {
      x: event.clientX,
      y: event.clientY,
      timestamp: Date.now(),
    };

    if (mouseSampleFrameRef.current === null) {
      mouseSampleFrameRef.current = requestAnimationFrame(flushPendingMouseSample);
    }
  }, [flushPendingMouseSample]);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (mouseSampleFrameRef.current !== null) {
        cancelAnimationFrame(mouseSampleFrameRef.current);
        mouseSampleFrameRef.current = null;
      }
    };
  }, [handleMouseMove]);

  // Timer countdown
  useEffect(() => {
    startTimeRef.current = Date.now();
    highResStartRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    hasCompletedRef.current = false;

    const tick = (now: number) => {
      const highResNow = typeof performance !== "undefined" ? now : Date.now();
      const elapsed = highResNow - highResStartRef.current;
      const remaining = Math.max(GAME_DURATION_MS - elapsed, 0);

      if (
        remaining === 0 ||
        highResNow - lastCountdownUpdateRef.current >= 90
      ) {
        lastCountdownUpdateRef.current = highResNow;
        setTimeRemaining(remaining);
      }

      if (remaining > 0) {
        countdownFrameRef.current = requestAnimationFrame(tick);
      } else {
        countdownFrameRef.current = null;
        setTimeRemaining(0);
      }
    };

    countdownFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (countdownFrameRef.current !== null) {
        cancelAnimationFrame(countdownFrameRef.current);
        countdownFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      mismatchTimeoutsRef.current.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      mismatchTimeoutsRef.current = [];
    };
  }, []);

  // Check for game completion
  useEffect(() => {
    if (hasCompletedRef.current) {
      return;
    }

    const allMatched = cards.every((card) => card.matched);

    if (allMatched || timeRemaining <= 0) {
      hasCompletedRef.current = true;

      const completionTime = Date.now() - startTimeRef.current;
      const matchedCount = cards.filter((card) => card.matched).length / 2;
      const accuracyRate = matchedCount / 3;

      // Find most repeated card
      let repeatedCard: number | undefined;
      let repeatCount = 0;
      Object.entries(cardFlipCounts).forEach(([cardId, count]) => {
        if (count > repeatCount) {
          repeatCount = count;
          repeatedCard = parseInt(cardId);
        }
      });

      const repeatedCardMeta =
        repeatCount >= 3 && repeatedCard !== undefined
          ? cards.find((card) => card.id === repeatedCard)
          : undefined;

      const metrics: VerificationMetrics = {
        completionTime,
        flipsTotal,
        accuracyRate,
        mouseMovements: mouseMovementsRef.current,
        clickTimings: clickTimingsRef.current,
        entropy: 0, // Will be calculated by entropy module
        repeatedCard: repeatCount >= 3 ? repeatedCard : undefined,
        repeatCount: repeatCount >= 3 ? repeatCount : undefined,
        repeatedCardIcon: repeatCount >= 3 ? repeatedCardMeta?.icon : undefined,
      };

      onComplete(metrics);
    }
  }, [cards, timeRemaining, flipsTotal, cardFlipCounts, onComplete]);

  const handleCardClick = (index: number) => {
    if (flippedIndices.length >= 2) return;
    if (cards[index].flipped || cards[index].matched) return;

    const now = Date.now();
    clickTimingsRef.current = [...clickTimingsRef.current.slice(-63), now];
    setFlipsTotal((prev) => prev + 1);

    // Track flip count per card
    setCardFlipCounts((prev) => ({
      ...prev,
      [cards[index].id]: (prev[cards[index].id] || 0) + 1,
    }));

    const newFlippedIndices = [...flippedIndices, index];
    setFlippedIndices(newFlippedIndices);

    setCards((prevCards) => {
      const newCards = [...prevCards];
      newCards[index] = { ...newCards[index], flipped: true };
      return newCards;
    });

    if (newFlippedIndices.length === 2) {
      const [firstIdx, secondIdx] = newFlippedIndices;
      
      if (cards[firstIdx].value === cards[secondIdx].value) {
        // Match found
        setCards((prevCards) => {
          const newCards = [...prevCards];
          newCards[firstIdx] = { ...newCards[firstIdx], matched: true };
          newCards[secondIdx] = { ...newCards[secondIdx], matched: true };
          return newCards;
        });
        setFlippedIndices([]);
      } else {
        // No match - flip back after delay
        const timeoutId = window.setTimeout(() => {
          setCards((prevCards) => {
            const newCards = [...prevCards];
            newCards[firstIdx] = { ...newCards[firstIdx], flipped: false };
            newCards[secondIdx] = { ...newCards[secondIdx], flipped: false };
            return newCards;
          });
          setFlippedIndices([]);
          mismatchTimeoutsRef.current = mismatchTimeoutsRef.current.filter((storedId) => storedId !== timeoutId);
        }, CARD_FLIP_DELAY);

        mismatchTimeoutsRef.current = [...mismatchTimeoutsRef.current, timeoutId];
      }
    }
  };

  const progressPercent = ((GAME_DURATION_MS - timeRemaining) / GAME_DURATION_MS) * 100;
  const timeSeconds = Math.ceil(timeRemaining / 1000);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Time Remaining</span>
          <span className="font-mono font-medium">{timeSeconds}s</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        {cards.map((card, index) => (
          <button
            key={card.id}
            onClick={() => handleCardClick(index)}
            disabled={card.matched || flippedIndices.length >= 2}
            className={cn(
              "aspect-square rounded-2xl border-2 transition-all duration-300",
              "flex items-center justify-center text-4xl",
              "hover:scale-105 active:scale-95",
              card.matched
                ? "border-primary/50 bg-primary/20 opacity-50"
                : card.flipped
                ? "border-primary bg-primary/10"
                : "border-border bg-background/40 hover:border-primary/50"
            )}
            aria-label={card.flipped || card.matched ? `Card ${card.icon}` : "Face down card"}
          >
            {(card.flipped || card.matched) ? card.icon : "?"}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Flips: {flipsTotal}</span>
        <span>Matched: {cards.filter((c) => c.matched).length / 2} / 3</span>
      </div>

      {showSkipOption && onSkip && (
        <div className="flex justify-center pt-4">
          <Button variant="ghost" onClick={onSkip}>
            {skipLabel ?? "I'll do this later"}
          </Button>
        </div>
      )}
    </div>
  );
}

