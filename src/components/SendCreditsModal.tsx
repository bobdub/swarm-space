import { useState, useEffect } from "react";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { transferCredits, getCreditBalance, CREDIT_REWARDS, tipUser } from "@/lib/credits";
import { getCurrentUser } from "@/lib/auth";
import { Textarea } from "@/components/ui/textarea";

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
  const [mode, setMode] = useState<"transfer" | "tip">("transfer");
  const [message, setMessage] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      loadBalance();
    }
    if (!isOpen) {
      setAmount("");
      setMessage("");
      setMode("transfer");
    }
  }, [isOpen]);

  const loadBalance = async () => {
    const user = await getCurrentUser();
    if (user) {
      const balance = await getCreditBalance(user.id);
      setUserBalance(balance);
      setCurrentUserId(user.id);
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

    if (currentUserId && currentUserId === toUserId) {
      toast({
        title: "Hold up",
        description: "You can't send credits to yourself",
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

    if (mode === "tip") {
      if (numAmount < CREDIT_REWARDS.TIP_MIN || numAmount > CREDIT_REWARDS.TIP_MAX) {
        toast({
          title: "Tip amount out of range",
          description: `Tips must be between ${CREDIT_REWARDS.TIP_MIN} and ${CREDIT_REWARDS.TIP_MAX} credits`,
          variant: "destructive",
        });
        return;
      }
    }

    setLoading(true);
    try {
      const note = message.trim() ? message.trim() : undefined;

      if (mode === "tip") {
        await tipUser(toUserId, numAmount, { message: note });
      } else {
        await transferCredits(toUserId, numAmount, { message: note });
      }

      toast({
        title: mode === "tip" ? "Tip sent!" : "Credits sent!",
        description:
          mode === "tip"
            ? `Tipped ${numAmount} credits to @${toUsername}`
            : `Sent ${numAmount} credits to @${toUsername}`,
      });
      setAmount("");
      setMessage("");
      await loadBalance();
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

  const maxAmount = mode === "tip"
    ? Math.min(userBalance, CREDIT_REWARDS.TIP_MAX)
    : Math.min(userBalance, CREDIT_REWARDS.MAX_TRANSFER);

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
              Intent
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => setMode("transfer")}
                variant={mode === "transfer" ? "default" : "outline"}
                className={`flex-1 rounded-xl ${
                  mode === "transfer"
                    ? "bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] text-[hsl(253,82%,6%)]"
                    : "border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)]"
                }`}
                disabled={loading}
              >
                Transfer
              </Button>
              <Button
                type="button"
                onClick={() => setMode("tip")}
                variant={mode === "tip" ? "default" : "outline"}
                className={`flex-1 rounded-xl ${
                  mode === "tip"
                    ? "bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] text-[hsl(253,82%,6%)]"
                    : "border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)]"
                }`}
                disabled={loading}
              >
                Tip
              </Button>
            </div>
            <p className="text-xs text-foreground/55">
              {mode === "tip"
                ? `Send quick appreciation. Tips are capped at ${CREDIT_REWARDS.TIP_MAX} credits.`
                : "Move larger balances or coordinate project funds."}
            </p>
          </div>

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
              min={mode === "tip" ? CREDIT_REWARDS.TIP_MIN : CREDIT_REWARDS.MIN_TRANSFER}
              max={maxAmount}
            />
            <p className="text-xs text-foreground/55">
              Your balance: {userBalance} credits{mode === "tip" ? ` • Tip window: ${CREDIT_REWARDS.TIP_MIN}-${CREDIT_REWARDS.TIP_MAX}` : null}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="credit-message" className="text-sm font-display uppercase tracking-[0.2em] text-foreground/70">
              Message <span className="lowercase text-foreground/55">(optional)</span>
            </Label>
            <Textarea
              id="credit-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Add a note of appreciation or context"
              maxLength={CREDIT_REWARDS.MAX_MESSAGE_LENGTH}
              className="min-h-[96px] rounded-xl border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)]"
              disabled={loading}
            />
            <p className="text-xs text-foreground/55">
              {message.length}/{CREDIT_REWARDS.MAX_MESSAGE_LENGTH} characters used
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
              {loading ? "Sending..." : mode === "tip" ? "Send Tip" : "Send Credits"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
