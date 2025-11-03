import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { MovementEntropyAccumulator } from "@/lib/verification/entropy";
import type { VerificationMetrics } from "@/types/verification";

interface DreamMatchGameProps {
  onComplete: (metrics: VerificationMetrics, repeatedCardImage?: string | null) => void;
  onFailure?: () => void;
  maxDurationMs?: number;
}

interface DreamMatchCard {
  id: string;
  symbol: string;
  label: string;
}

interface ActiveCard extends DreamMatchCard {
  uid: string;
}

const CARD_SET: DreamMatchCard[] = [
  { id: "starlit", symbol: "🌠", label: "Starlit Echo" },
  { id: "mirror", symbol: "🪞", label: "Reflective Bloom" },
  { id: "hourglass", symbol: "⏳", label: "Temporal Drift" },
];

const GRID_SIZE = 6;
const FLIP_BACK_DELAY_MS = 1800;
const DEFAULT_DURATION_MS = 150_000;

interface FlipRecord {
  cardId: string;
  timestamp: number;
  symbol: string;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const DreamMatchGame = ({
  onComplete,
  onFailure,
  maxDurationMs = DEFAULT_DURATION_MS,
}: DreamMatchGameProps) => {
  const deck = useMemo<ActiveCard[]>(() => {
    const duplicated = CARD_SET.flatMap((card, index) => {
      return [
        { ...card, uid: `${card.id}-${index}-a` },
        { ...card, uid: `${card.id}-${index}-b` },
      ];
    });
    return shuffle(duplicated).slice(0, GRID_SIZE);
  }, []);

  const [flipped, setFlipped] = useState<string[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [attempts, setAttempts] = useState(0);
  const [matches, setMatches] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(maxDurationMs);
  const [startTime] = useState(() => performance.now());
  const flipHistory = useRef<FlipRecord[]>([]);
  const entropyTracker = useRef(new MovementEntropyAccumulator());
  const animationFrameRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const totalPairs = useMemo(() => deck.length / 2, [deck.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      entropyTracker.current.addPoint(x, y, performance.now());
    };

    const initialRect = container.getBoundingClientRect();
    entropyTracker.current.start(initialRect.width / 2, initialRect.height / 2, performance.now());
    container.addEventListener("mousemove", handleMouseMove);
    return () => {
      container.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const remaining = Math.max(0, maxDurationMs - elapsed);
      setTimeRemaining(remaining);
      if (remaining === 0) {
        if (onFailure) {
          onFailure();
        }
        return;
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [maxDurationMs, onFailure, startTime]);

  const handleCardClick = useCallback(
    (card: ActiveCard) => {
      if (isLocked || matched.has(card.uid) || flipped.includes(card.uid)) {
        return;
      }

      setFlipped((prev) => [...prev, card.uid]);
      flipHistory.current.push({ cardId: card.id, timestamp: Date.now(), symbol: card.symbol });

      if (flipped.length === 1) {
        setIsLocked(true);
        setTimeout(() => {
          setIsLocked(false);
        }, 220);
      }

      if (flipped.length + 1 === 2) {
        setIsLocked(true);
        setAttempts((previous) => previous + 1);

        setTimeout(() => {
          setFlipped((current) => {
            if (current.length < 2) {
              setIsLocked(false);
              return [];
            }

            const [firstUid, secondUid] = current;
            const firstCard = deck.find((item) => item.uid === firstUid);
            const secondCard = deck.find((item) => item.uid === secondUid);

            if (firstCard && secondCard && firstCard.id === secondCard.id) {
              setMatched((prev) => new Set(prev).add(firstCard.uid).add(secondCard.uid));
              setMatches((prev) => prev + 1);
            }

            setTimeout(() => {
              setIsLocked(false);
            }, 120);

            return [];
          });
        }, FLIP_BACK_DELAY_MS);
      }
    },
    [deck, flipped, isLocked, matched],
  );

  useEffect(() => {
    if (matches === totalPairs) {
      const elapsed = performance.now() - startTime;
      const entropyResult = entropyTracker.current.result();
      const repeated = flipHistory.current.reduce<Record<string, number>>((acc, record) => {
        acc[record.cardId] = (acc[record.cardId] ?? 0) + 1;
        return acc;
      }, {});
      const repeatedEntry = Object.entries(repeated).reduce<{
        cardId: string | null;
        flips: number;
        symbol: string | null;
      }>(
        (current, [cardId, count]) => {
          if (count > current.flips) {
            const symbol = flipHistory.current.find((record) => record.cardId === cardId)?.symbol ?? null;
            return { cardId, flips: count, symbol };
          }
          return current;
        },
        { cardId: null, flips: 0, symbol: null },
      );

      const metrics: VerificationMetrics = {
        totalTimeMs: elapsed,
        moveCount: attempts,
        perfectAccuracy: attempts === matches,
        repeatedCardId: repeatedEntry.cardId,
        repeatedCardFlips: repeatedEntry.flips,
        entropyScore: entropyResult.entropy,
        accuracy: matches === 0 ? 0 : matches / Math.max(attempts, 1),
      };

      onComplete(metrics, repeatedEntry.symbol);
    }
  }, [attempts, matches, onComplete, startTime, totalPairs]);

  const progress = useMemo(() => {
    const percentage = (matches / totalPairs) * 100;
    return Number.isFinite(percentage) ? percentage : 0;
  }, [matches, totalPairs]);

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="text-2xl">Dream Match Verification</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4" ref={containerRef}>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Match the pairs to prove you are human.</span>
            <span>{Math.ceil(timeRemaining / 1000)}s remaining</span>
          </div>
          <Progress value={progress} />
          <div className="grid grid-cols-3 gap-3">
            {deck.map((card) => {
              const isMatched = matched.has(card.uid);
              const isFlipped = flipped.includes(card.uid) || isMatched;
              return (
                <Button
                  key={card.uid}
                  variant="outline"
                  className={`h-24 text-3xl transition-transform ${
                    isFlipped ? "bg-primary/10" : "bg-muted"
                  } ${isMatched ? "ring-2 ring-primary" : ""}`}
                  onClick={() => handleCardClick(card)}
                  disabled={isLocked || isMatched}
                >
                  <span aria-hidden>{isFlipped ? card.symbol : "❔"}</span>
                  <span className="sr-only">{card.label}</span>
                </Button>
              );
            })}
          </div>
          <div className="text-sm text-muted-foreground">
            <p>
              Moves: <strong>{attempts}</strong> • Matches: <strong>{matches}</strong>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DreamMatchGame;
