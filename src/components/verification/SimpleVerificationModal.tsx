import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { markVerified, recordVerificationAttempt } from "@/lib/verification/storage";
import { evaluateAchievementEvent } from "@/lib/achievements";

interface SimpleVerificationModalProps {
  open: boolean;
  userId: string;
  onComplete: () => void;
  onSkip?: () => void;
}

const CARD_ICONS = ["🌙", "✨", "🌟"];

export function SimpleVerificationModal({
  open,
  userId,
  onComplete,
  onSkip,
}: SimpleVerificationModalProps) {
  const [cards, setCards] = useState<string[]>([]);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (open) {
      // Initialize game
      const shuffled = [...CARD_ICONS, ...CARD_ICONS]
        .sort(() => Math.random() - 0.5);
      setCards(shuffled);
      setFlipped([]);
      setMatched([]);
      setMoves(0);
      setIsProcessing(false);
      console.log('[SimpleVerification] Game initialized');
    }
  }, [open]);

  const handleComplete = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    
    console.log('[SimpleVerification] Game complete, saving...');
    
    try {
      await recordVerificationAttempt(userId);
      
      // Create proper verification proof
      const proof = {
        id: userId,
        userId,
        timestamp: new Date().toISOString(),
        medal: 'dream-matcher' as const,
        signature: 'simple-verification',
        creditsEarned: 1,
        humanVerified: true as const,
        metrics: {
          completionTime: Date.now(),
          flipsTotal: moves,
          accuracyRate: 1,
          mouseMovements: [],
          clickTimings: [],
          entropy: 0.5,
        },
        publicKey: '',
      };
      
      await markVerified(userId, proof, { attempts: moves });
      
      toast.success("Verification complete! 🎉", {
        description: `Completed in ${moves} moves`,
        duration: 3000,
      });
      
      setTimeout(() => {
        onComplete();
      }, 500);
    } catch (error) {
      console.error('[SimpleVerification] Failed to save:', error);
      toast.error("Verification failed. Please try again.");
      setIsProcessing(false);
    }
  }, [isProcessing, userId, moves, onComplete]);

  useEffect(() => {
    if (matched.length === cards.length && cards.length > 0) {
      void handleComplete();
    }
  }, [matched, cards, handleComplete]);

  const handleCardClick = (index: number) => {
    if (isProcessing) return;
    if (flipped.length >= 2) return;
    if (flipped.includes(index)) return;
    if (matched.includes(index)) return;

    console.log('[SimpleVerification] Card clicked:', index);

    const newFlipped = [...flipped, index];
    setFlipped(newFlipped);

    if (newFlipped.length === 2) {
      setMoves(moves + 1);
      const [first, second] = newFlipped;
      
      if (cards[first] === cards[second]) {
        // Match!
        console.log('[SimpleVerification] Match found!');
        setMatched([...matched, first, second]);
        setFlipped([]);
      } else {
        // No match - flip back after delay
        console.log('[SimpleVerification] No match');
        setTimeout(() => {
          setFlipped([]);
        }, 1000);
      }
    }
  };

  const handleSkip = () => {
    console.log('[SimpleVerification] Skipped');
    if (onSkip) {
      onSkip();
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent 
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Verification Game
          </DialogTitle>
          <DialogDescription>
            Match the pairs to verify you're human. Moves: {moves}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 py-4">
          {cards.map((card, index) => {
            const isFlipped = flipped.includes(index);
            const isMatched = matched.includes(index);
            const showCard = isFlipped || isMatched;

            return (
              <button
                key={index}
                onClick={() => handleCardClick(index)}
                disabled={isMatched || isProcessing}
                className={`
                  aspect-square rounded-xl border-2 text-3xl
                  transition-all duration-200
                  flex items-center justify-center
                  ${showCard 
                    ? 'bg-primary/10 border-primary' 
                    : 'bg-background border-border hover:border-primary/50'
                  }
                  ${isMatched ? 'opacity-50' : ''}
                  disabled:cursor-not-allowed
                  hover:scale-105 active:scale-95
                `}
              >
                {showCard ? card : '?'}
              </button>
            );
          })}
        </div>

        {onSkip && (
          <div className="flex justify-center pt-2">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={handleSkip}
              disabled={isProcessing}
            >
              Skip for now
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
