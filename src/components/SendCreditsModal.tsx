import { useState, useEffect } from "react";
import { Coins, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { transferCredits, getCreditBalance, CREDIT_REWARDS } from "@/lib/credits";
import { getCurrentUser } from "@/lib/auth";

interface SendCreditsModalProps {
  toUserId: string;
  toUsername: string;
  isOpen: boolean;
  onClose: () => void;
}

export function SendCreditsModal({ toUserId, toUsername, isOpen, onClose }: SendCreditsModalProps) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [userBalance, setUserBalance] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      loadBalance();
    }
  }, [isOpen]);

  const loadBalance = async () => {
    const user = await getCurrentUser();
    if (user) {
      const balance = await getCreditBalance(user.id);
      setUserBalance(balance);
    }
  };

  const handleSend = async () => {
    const numAmount = parseInt(amount);
    
    if (isNaN(numAmount) || numAmount <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    if (numAmount > userBalance) {
      toast({
        title: "Insufficient credits",
        description: `You only have ${userBalance} credits`,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      await transferCredits(toUserId, numAmount);
      toast({
        title: "Credits sent!",
        description: `Sent ${numAmount} credits to @${toUsername}`,
      });
      setAmount("");
      onClose();
    } catch (error) {
      console.error("Failed to send credits:", error);
      toast({
        title: "Failed to send credits",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="rounded-[24px] border border-[hsla(174,59%,56%,0.22)] bg-[hsla(245,70%,8%,0.95)] backdrop-blur-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-display uppercase tracking-[0.15em]">
            <Coins className="h-5 w-5 text-[hsl(326,71%,62%)]" />
            Send Credits
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 pt-4">
          <div className="space-y-2">
            <Label className="text-sm font-display uppercase tracking-[0.2em] text-foreground/70">
              Recipient
            </Label>
            <div className="rounded-xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-4 py-3 text-sm text-foreground">
              @{toUsername}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount" className="text-sm font-display uppercase tracking-[0.2em] text-foreground/70">
              Amount
            </Label>
            <Input
              id="amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="rounded-xl border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)]"
              min={CREDIT_REWARDS.MIN_TRANSFER}
              max={Math.min(userBalance, CREDIT_REWARDS.MAX_TRANSFER)}
            />
            <p className="text-xs text-foreground/55">
              Your balance: {userBalance} credits
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={onClose}
              variant="outline"
              className="flex-1 rounded-xl"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              className="flex-1 rounded-xl"
              disabled={loading || !amount}
            >
              {loading ? "Sending..." : "Send Credits"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
