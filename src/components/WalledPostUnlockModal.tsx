import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, Coins } from "lucide-react";
import { toast } from "sonner";
import { unlockPost } from "@/lib/blockchain/walledPost";
import type { Post } from "@/types";

interface WalledPostUnlockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: Post;
  userId: string;
}

export function WalledPostUnlockModal({ open, onOpenChange, post, userId }: WalledPostUnlockModalProps) {
  const [isUnlocking, setIsUnlocking] = useState(false);

  const unlockCost = post.unlockCostAmount ?? 0;
  const unlockTicker = post.unlockCostTicker ?? "TOKEN";
  const unlockTokenId = post.unlockCostTokenId ?? "";

  const handleUnlock = async () => {
    setIsUnlocking(true);
    try {
      await unlockPost(userId, post.id, unlockTokenId, unlockTicker, unlockCost);
      toast.success(`Post unlocked for ${unlockCost} ${unlockTicker}!`);
      onOpenChange(false);
    } catch (error) {
      console.error("[WalledPostUnlock] Failed:", error);
      toast.error(error instanceof Error ? error.message : "Failed to unlock post");
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-[hsla(174,59%,56%,0.28)] bg-[hsla(245,70%,8%,0.92)] backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold uppercase tracking-[0.2em] text-foreground">
            <Lock className="h-5 w-5 text-[hsl(326,71%,62%)]" />
            Unlock Content
          </DialogTitle>
          <DialogDescription className="text-sm text-foreground/70">
            This post is behind an encrypted wall. Pay the unlock fee to access the content.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.55)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-foreground/60">
                Unlock Cost
              </span>
              <span className="text-lg font-bold text-foreground">
                {unlockCost} <span className="text-sm text-[hsl(174,59%,66%)]">${unlockTicker}</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-foreground/60">
                Processing
              </span>
              <span className="text-xs text-foreground/50">
                Tokens wrapped into serving coin
              </span>
            </div>
          </div>

          <p className="text-xs text-foreground/50 leading-relaxed">
            Your payment tokens will be wrapped inside the SWARM coin serving this content.
            The creator can extract payments later. You must be actively mining to unlock.
          </p>
        </div>

        <DialogFooter className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[hsla(174,59%,56%,0.25)] text-foreground/70 hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleUnlock}
            disabled={isUnlocking}
            className="gap-2 bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)]"
          >
            {isUnlocking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
            {isUnlocking ? "Unlocking..." : `Pay ${unlockCost} ${unlockTicker}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
