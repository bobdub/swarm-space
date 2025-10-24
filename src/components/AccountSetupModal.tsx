import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLocalAccount, UserMeta } from "@/lib/auth";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { z } from "zod";

const accountSchema = z.object({
  username: z.string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be less than 20 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  displayName: z.string()
    .trim()
    .min(1, "Display name is required")
    .max(50, "Display name must be less than 50 characters"),
});

interface AccountSetupModalProps {
  open: boolean;
  onComplete: (user: UserMeta) => void;
  onDismiss?: () => void;
}

export function AccountSetupModal({ open, onComplete, onDismiss }: AccountSetupModalProps) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ username?: string; displayName?: string }>({});

  const handleDismiss = () => {
    onDismiss?.();
  };

  const handleCreate = async () => {
    setErrors({});
    
    // Validate input
    const validation = accountSchema.safeParse({ username, displayName });
    if (!validation.success) {
      const fieldErrors: { username?: string; displayName?: string } = {};
      validation.error.errors.forEach((err) => {
        if (err.path[0] === "username") fieldErrors.username = err.message;
        if (err.path[0] === "displayName") fieldErrors.displayName = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    try {
      const user = await createLocalAccount(
        validation.data.username,
        validation.data.displayName
      );
      
      toast.success(`Welcome, ${user.displayName}! +100 genesis credits awarded`);
      onComplete(user);
    } catch (error) {
      console.error("Account creation failed:", error);
      toast.error("Failed to create account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        handleDismiss();
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl">Welcome to Imagination Network</DialogTitle>
          <DialogDescription>
            Create your account to get started. Your identity is stored locally and encrypted.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="yourname"
              disabled={loading}
              className={errors.username ? "border-destructive" : ""}
            />
            {errors.username && (
              <p className="text-xs text-destructive">{errors.username}</p>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your Name"
              disabled={loading}
              className={errors.displayName ? "border-destructive" : ""}
            />
            {errors.displayName && (
              <p className="text-xs text-destructive">{errors.displayName}</p>
            )}
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs text-foreground/80">
              🎉 <strong>Genesis Bonus:</strong> You'll receive 100 credits to start exploring the network!
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleDismiss}
            disabled={loading}
          >
            Maybe Later
          </Button>
          <Button
            onClick={handleCreate}
            disabled={loading || !username || !displayName}
            className="w-full bg-gradient-to-r from-primary to-secondary"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Account...
              </>
            ) : (
              "Create Account & Continue"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
