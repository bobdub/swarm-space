import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { MemoryCard, VerificationMetrics } from "@/lib/verification/types";
import { cn } from "@/lib/utils";

interface DreamMatchGameProps {
  onComplete: (metrics: VerificationMetrics) => void;
  onSkip?: () => void;
  showSkipOption?: boolean;
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

export function DreamMatchGame({ onComplete, onSkip, showSkipOption }: DreamMatchGameProps) {
  const [cards, setCards] = useState<MemoryCard[]>(() => shuffleCards());
  const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
  const [timeRemaining, setTimeRemaining] = useState(GAME_DURATION_MS);
  const [startTime] = useState(Date.now());
  const [mouseMovements, setMouseMovements] = useState<Array<{ x: number; y: number; timestamp: number }>>([]);
  const [clickTimings, setClickTimings] = useState<number[]>([]);
  const [flipsTotal, setFlipsTotal] = useState(0);
  const [cardFlipCounts, setCardFlipCounts] = useState<Record<number, number>>({});
  const gameRef = useRef<HTMLDivElement>(null);

  // Track mouse movements
  const handleMouseMove = useCallback((e: MouseEvent) => {
    setMouseMovements((prev) => [
      ...prev,
      { x: e.clientX, y: e.clientY, timestamp: Date.now() },
    ]);
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove]);

  // Timer countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        const next = prev - 100;
        if (next <= 0) {
          clearInterval(interval);
          return 0;
        }
        return next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  // Check for game completion
  useEffect(() => {
    const allMatched = cards.every((card) => card.matched);
    
    if (allMatched || timeRemaining <= 0) {
      const completionTime = Date.now() - startTime;
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

      const metrics: VerificationMetrics = {
        completionTime,
        flipsTotal,
        accuracyRate,
        mouseMovements,
        clickTimings,
        entropy: 0, // Will be calculated by entropy module
        repeatedCard: repeatCount >= 3 ? repeatedCard : undefined,
        repeatCount: repeatCount >= 3 ? repeatCount : undefined,
      };

      onComplete(metrics);
    }
  }, [cards, timeRemaining, startTime, flipsTotal, mouseMovements, clickTimings, cardFlipCounts, onComplete]);

  const handleCardClick = (index: number) => {
    if (flippedIndices.length >= 2) return;
    if (cards[index].flipped || cards[index].matched) return;

    const now = Date.now();
    setClickTimings((prev) => [...prev, now]);
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
        setTimeout(() => {
          setCards((prevCards) => {
            const newCards = [...prevCards];
            newCards[firstIdx] = { ...newCards[firstIdx], flipped: false };
            newCards[secondIdx] = { ...newCards[secondIdx], flipped: false };
            return newCards;
          });
          setFlippedIndices([]);
        }, CARD_FLIP_DELAY);
      }
    }
  };

  const progressPercent = ((GAME_DURATION_MS - timeRemaining) / GAME_DURATION_MS) * 100;
  const timeSeconds = Math.ceil(timeRemaining / 1000);

  return (
    <div className="space-y-6" ref={gameRef}>
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
            I'll do this later
          </Button>
        </div>
      )}
    </div>
  );
}
