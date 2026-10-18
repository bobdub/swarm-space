import { useState, useEffect } from "react";
import { Coins, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { transferCredits, getCreditBalance, CREDIT_REWARDS, tipUser } from "@/lib/credits";
import { getCurrentUser } from "@/lib/auth";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getWalletTipAssets, sendWalletTip, type TipAsset } from "@/lib/blockchain/wallets/walletTips";
import { nativeWalletAddress } from "@/lib/blockchain/wallets/nativeAddress";

interface SendCreditsModalProps {
  toUserId: string;
  toUsername: string;
  isOpen: boolean;
  onClose: () => void;
}

export function SendCreditsModal({ toUserId, toUsername, isOpen, onClose }: SendCreditsModalProps) {
  const [amount, setAmount] = useState("");
  const [assets, setAssets] = useState<TipAsset[]>([]);
  const [assetId, setAssetId] = useState("credits");
  const selectedAsset = assets.find(a => a.id === assetId);
  const isCredits = assetId === "credits";
  const ticker = selectedAsset?.ticker ?? "Credits";
  const [loading, setLoading] = useState(false);
  const [userBalance, setUserBalance] = useState(0);
  const [mode, setMode] = useState<"transfer" | "tip">("transfer");
  const [message, setMessage] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      void loadBalance();
    }
    if (!isOpen) {
      setAmount("");
      setMessage("");
      setMode("transfer");
    }
  }, [isOpen, toUserId]);

  const loadBalance = async () => {
    const user = await getCurrentUser();
    if (user) {
      const nextAssets = await getWalletTipAssets(user.id);
      setAssets(nextAssets);
      setUserBalance(nextAssets.find(a => a.id === assetId)?.balance ?? 0);
      setCurrentUserId(user.id);
    }
  };

  const handleSend = async () => {
    const numAmount = Number(amount);

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

    if (numAmount > (selectedAsset?.balance ?? 0)) {
      toast({
        title: "Insufficient credits",
        description: `You only have ${selectedAsset?.balance ?? 0} ${ticker}`,
        variant: "destructive",
      });
      return;
    }

    if (mode === "tip" && isCredits) {
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

      await sendWalletTip({ recipient: nativeWalletAddress(toUserId), assetId,
        amount: numAmount, message: note, intent: mode });

      toast({
        title: mode === "tip" ? "Tip sent!" : "Payment recorded!",
        description:
          mode === "tip"
            ? `Tipped ${numAmount} ${ticker} to @${toUsername}`
            : `Sent ${numAmount} ${ticker} to @${toUsername}`,
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

  const balance = selectedAsset?.balance ?? 0;
  const maxAmount = isCredits ? Math.min(balance, mode === "tip" ? CREDIT_REWARDS.TIP_MAX : CREDIT_REWARDS.MAX_TRANSFER) : balance;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="rounded-[24px] border border-border bg-card backdrop-blur-2xl sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-display uppercase tracking-[0.15em]">
            <Coins className="h-5 w-5 text-primary" />
            Send & Tip
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
                    ? "bg-primary text-primary-foreground"
                    : "border-border bg-card"
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
                    ? "bg-primary text-primary-foreground"
                    : "border-border bg-card"
                }`}
                disabled={loading}
              >
                Tip
              </Button>
            </div>

          </div>

          <div className="space-y-2">
            <Label className="text-sm font-display uppercase tracking-[0.2em] text-foreground/70">
              Recipient
            </Label>
            <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground">
              @{toUsername}
              <div className="mt-2 flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 break-all font-mono text-xs">{nativeWalletAddress(toUserId)}</span>
                <Button type="button" variant="ghost" size="icon" aria-label="Copy SWARM wallet address" title="Copy SWARM wallet address"
                  onClick={() => void navigator.clipboard.writeText(nativeWalletAddress(toUserId)).then(() => toast({ title: "Wallet address copied" })).catch(() => toast({ title: "Copy failed", variant: "destructive" }))}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tip-asset">Asset</Label>
            <Select value={assetId} onValueChange={value => { setAssetId(value); setAmount(""); }} disabled={loading}>
              <SelectTrigger id="tip-asset"><SelectValue placeholder="Select asset" /></SelectTrigger>
              <SelectContent>
                {assets.map(asset => <SelectItem key={asset.id} value={asset.id}>
                  {asset.ticker} · {asset.balance.toLocaleString()} · {asset.name}
                </SelectItem>)}
              </SelectContent>
            </Select>
            {selectedAsset?.unavailable && <p role="alert" className="text-xs text-destructive">{selectedAsset.unavailable}</p>}
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
              className="rounded-xl border-border bg-card"
              min={isCredits ? 1 : "0.00000001"}
              step={isCredits ? 1 : "any"}
              disabled={loading || !!selectedAsset?.unavailable}
              max={maxAmount}
            />
            <p className="text-xs text-foreground/55">
              Your balance: {balance.toLocaleString()} {ticker}{mode === "tip" && isCredits ? ` • Tip window: ${CREDIT_REWARDS.TIP_MIN}-${CREDIT_REWARDS.TIP_MAX}` : null}
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
              className="min-h-[96px] rounded-xl border-border bg-card"
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
              disabled={loading || !amount || !selectedAsset || !!selectedAsset.unavailable}
            >
              {loading ? "Sending..." : mode === "tip" ? "Send Tip" : "Send Payment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
