import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, Loader2, Coins } from "lucide-react";
import { toast } from "sonner";
import {
  unlockPost,
  getUserPaymentAssets,
  calculateDynamicCost,
  type PaymentAsset,
} from "@/lib/blockchain/walledPost";
import { TOKEN_TO_SWARM_RATIO } from "@/lib/blockchain/types";
import type { Post } from "@/types";

interface WalledPostUnlockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: Post;
  userId: string;
}

export function WalledPostUnlockModal({ open, onOpenChange, post, userId }: WalledPostUnlockModalProps) {
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [paymentAssets, setPaymentAssets] = useState<PaymentAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>("SWARM");
  const [loadingAssets, setLoadingAssets] = useState(false);

  const unlockCost = post.unlockCostAmount ?? 0;
  const unlockTicker = post.unlockCostTicker ?? "TOKEN";

  // Load available payment assets when modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingAssets(true);
    getUserPaymentAssets(userId).then((assets) => {
      if (!cancelled) {
        setPaymentAssets(assets);
        setLoadingAssets(false);
      }
    }).catch(() => {
      if (!cancelled) setLoadingAssets(false);
    });
    return () => { cancelled = true; };
  }, [open, userId]);

  const selectedAsset = paymentAssets.find((a) => a.id === selectedAssetId) ?? paymentAssets[0];

  // Calculate dynamic cost: unlock cost (in creator tokens) → SWARM → user asset
  const unlockCostInSwarm = unlockCost / TOKEN_TO_SWARM_RATIO;
  const dynamicCost = selectedAsset
    ? Math.ceil(unlockCostInSwarm * selectedAsset.ratioToSwarm)
    : unlockCost;

  const handleUnlock = async () => {
    if (!selectedAsset) return;
    setIsUnlocking(true);
    try {
      await unlockPost(userId, post.id, selectedAsset);
      toast.success(`Post unlocked! Paid ${dynamicCost} ${selectedAsset.ticker}`);
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
            Pay to access this encrypted content. Choose your payment asset.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {/* Original unlock cost */}
          <div className="rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.55)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-foreground/60">
                Unlock Cost
              </span>
              <span className="text-sm text-foreground/70">
                {unlockCost} <span className="text-[hsl(174,59%,66%)]">${unlockTicker}</span>
              </span>
            </div>

            {/* Payment asset selector */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-[0.25em] text-foreground/60">
                Pay With
              </Label>
              {loadingAssets ? (
                <div className="flex items-center gap-2 text-xs text-foreground/50">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading assets…
                </div>
              ) : (
                <Select value={selectedAssetId} onValueChange={setSelectedAssetId}>
                  <SelectTrigger className="border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.6)]">
                    <SelectValue placeholder="Select payment asset" />
                  </SelectTrigger>
                  <SelectContent className="border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.95)] backdrop-blur-xl">
                    {paymentAssets.map((asset) => (
                      <SelectItem key={asset.id} value={asset.id}>
                        ${asset.ticker} ({asset.ratioToSwarm}:1 ratio)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Dynamic cost display */}
            <div className="flex items-center justify-between rounded-lg border border-[hsla(326,71%,62%,0.2)] bg-[hsla(326,71%,62%,0.08)] px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-[hsl(326,71%,72%)]">
                You Pay
              </span>
              <span className="text-lg font-bold text-foreground">
                {dynamicCost} <span className="text-sm text-[hsl(326,71%,62%)]">${selectedAsset?.ticker ?? "—"}</span>
              </span>
            </div>

            {selectedAsset && selectedAsset.type !== "swarm" && (
              <p className="text-[0.65rem] text-foreground/45">
                {dynamicCost} {selectedAsset.ticker} auto-swaps to {unlockCostInSwarm.toFixed(1)} SWARM equivalent at {selectedAsset.ratioToSwarm}:1 ratio via community pool
              </p>
            )}
          </div>

          <p className="text-xs text-foreground/50 leading-relaxed">
            Tokens are wrapped into the serving SWARM coin. You must be actively mining to unlock.
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
            disabled={isUnlocking || !selectedAsset}
            className="gap-2 bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)]"
          >
            {isUnlocking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
            {isUnlocking ? "Unlocking..." : `Pay ${dynamicCost} ${selectedAsset?.ticker ?? ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
