import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createLocalAccount,
  getCurrentUser,
  getStoredAccounts,
  restoreLocalAccount,
  type UserMeta,
} from "@/lib/auth";
import {
  assessStorageHealth,
  type StorageHealth,
} from "@/lib/onboarding/storageHealth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Clock3, History, Loader2, ShieldAlert } from "lucide-react";
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
  const [existingAccounts, setExistingAccounts] = useState<UserMeta[]>([]);
  const [activeUser, setActiveUser] = useState<UserMeta | null>(null);
  const [restoringAccountId, setRestoringAccountId] = useState<string | null>(null);
  const [storageHealth, setStorageHealth] = useState<StorageHealth | null>(null);
  const [checkingIdentity, setCheckingIdentity] = useState(false);
  const [wantsReplacement, setWantsReplacement] = useState(false);
  const [replaceCountdown, setReplaceCountdown] = useState(5);

  const handleDismiss = () => {
    onDismiss?.();
  };

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    setCheckingIdentity(true);

    const loadIdentityState = async () => {
      try {
        const [health, storedAccounts] = await Promise.all([
          assessStorageHealth(),
          getStoredAccounts(),
        ]);

        let currentUser: UserMeta | null = null;
        try {
          currentUser = getCurrentUser();
        } catch (error) {
          console.warn("[AccountSetup] Unable to load current user", error);
        }

        if (cancelled) {
          return;
        }

        setStorageHealth(health);
        setActiveUser(currentUser);
        setExistingAccounts(
          currentUser
            ? storedAccounts.filter((account) => account.id !== currentUser.id)
            : storedAccounts,
        );
      } catch (error) {
        console.warn("[AccountSetup] Failed to inspect local identity state", error);
      } finally {
        if (!cancelled) {
          setCheckingIdentity(false);
        }
      }
    };

    loadIdentityState();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setWantsReplacement(false);
      setReplaceCountdown(5);
      setRestoringAccountId(null);
    }
  }, [open]);

  const hasExistingIdentity = useMemo(
    () => Boolean(activeUser || existingAccounts.length > 0),
    [activeUser, existingAccounts],
  );

  useEffect(() => {
    if (!open || !hasExistingIdentity || !wantsReplacement) {
      return;
    }

    if (replaceCountdown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setReplaceCountdown((value) => (value > 0 ? value - 1 : 0));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open, hasExistingIdentity, wantsReplacement, replaceCountdown]);

  useEffect(() => {
    if (!hasExistingIdentity) {
      setWantsReplacement(false);
      setReplaceCountdown(5);
    }
  }, [hasExistingIdentity]);

  const storedAccounts = useMemo(() => {
    const seen = new Set<string>();
    const ordered: UserMeta[] = [];

    if (activeUser && !seen.has(activeUser.id)) {
      ordered.push(activeUser);
      seen.add(activeUser.id);
    }

    for (const account of existingAccounts) {
      if (!seen.has(account.id)) {
        ordered.push(account);
        seen.add(account.id);
      }
    }

    return ordered;
  }, [activeUser, existingAccounts]);

  const overrideReady = !hasExistingIdentity || (wantsReplacement && replaceCountdown === 0);
  const storageIssues = storageHealth?.issues ?? [];

  const creationButtonLabel = hasExistingIdentity
    ? overrideReady
      ? "Replace Existing Identity"
      : "Review Stored Identities First"
    : "Create Account & Continue";

  const handleRestoreAccount = async (accountId: string) => {
    setRestoringAccountId(accountId);
    try {
      const restored = await restoreLocalAccount(accountId);
      if (!restored) {
        toast.error("Unable to recover the selected account.");
        return;
      }

      toast.success(`Restored ${restored.displayName ?? restored.username}`);
      onComplete(restored);
    } catch (error) {
      console.error("Account restore failed:", error);
      toast.error("Failed to restore account. Check storage permissions and try again.");
    } finally {
      setRestoringAccountId(null);
    }
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

    if (hasExistingIdentity && !overrideReady) {
      toast.error("Review existing identities before creating a new one.");
      setWantsReplacement(true);
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
          {checkingIdentity && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking local storage for existing Flux identities…
            </div>
          )}

          {storageIssues.length > 0 && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Storage access looks restricted</AlertTitle>
              <AlertDescription className="space-y-2">
                {storageIssues.map((issue, index) => (
                  <p key={index}>{issue}</p>
                ))}
                <p className="text-xs text-muted-foreground">
                  Flux Mesh relies on local storage and IndexedDB. Update your browser settings or
                  disable private browsing to ensure identities and drafts are preserved.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {hasExistingIdentity && (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Local identity data detected</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  We found Flux Mesh credentials on this device. Restore an existing profile or
                  confirm that you want to replace the stored keys.
                </p>
                {storedAccounts.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <History className="h-4 w-4" />
                      Available identities
                    </div>
                    <ul className="space-y-1 text-sm">
                      {storedAccounts.map((account) => (
                        <li key={account.id} className="flex items-center justify-between gap-3">
                          <span className="truncate">
                            {account.displayName ?? account.username}
                            <span className="ml-2 text-xs text-muted-foreground">
                              @{account.username}
                            </span>
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRestoreAccount(account.id)}
                            disabled={restoringAccountId === account.id}
                          >
                            {restoringAccountId === account.id ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Restoring…
                              </>
                            ) : (
                              "Restore"
                            )}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {!wantsReplacement ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setWantsReplacement(true);
                      setReplaceCountdown(5);
                    }}
                    className="gap-2"
                  >
                    <ShieldAlert className="h-4 w-4" />
                    Prepare to replace local data
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 p-2 text-xs text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    {replaceCountdown > 0 ? (
                      <span>
                        Replacing existing keys in {replaceCountdown} second{replaceCountdown === 1 ? "" : "s"}. You can still
                        cancel by restoring an account above.
                      </span>
                    ) : (
                      <span className="text-foreground">
                        Countdown complete. Creating a new account will overwrite the stored keys.
                      </span>
                    )}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

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
            disabled={
              loading ||
              !username ||
              !displayName ||
              (hasExistingIdentity && !overrideReady) ||
              restoringAccountId !== null
            }
            className="w-full bg-gradient-to-r from-primary to-secondary"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Account...
              </>
            ) : (
              creationButtonLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
