import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  Key,
  Download,
  Upload,
  User,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import {
  getCurrentUser,
  createLocalAccount,
  exportAccountBackup,
  importAccountBackup,
  getStoredAccounts,
  restoreLocalAccount,
  type UserMeta,
} from "@/lib/auth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { get } from "@/lib/store";
import { getBlockedUserIds, unblockUser } from "@/lib/connections";
import { Avatar } from "@/components/Avatar";
import type { User as NetworkUser } from "@/types";
import { useWalkthrough } from "@/contexts/WalkthroughContext";
import { WALKTHROUGH_STEPS } from "@/lib/onboarding/constants";
import { AccountExportModal } from "@/components/AccountExportModal";

const Settings = () => {
  const [user, setUser] = useState(getCurrentUser());
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [isBlockedUsersLoading, setIsBlockedUsersLoading] = useState(false);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<{
    id: string;
    username: string;
    displayName?: string;
    avatarRef?: string;
  }[]>([]);
  const [storedAccounts, setStoredAccounts] = useState<UserMeta[]>([]);
  const [isLoadingStoredAccounts, setIsLoadingStoredAccounts] = useState(false);
  const [restoringAccountId, setRestoringAccountId] = useState<string | null>(null);
  const navigate = useNavigate();
  const {
    state: walkthroughState,
    start: startWalkthrough,
    resume: resumeWalkthrough,
    reset: resetWalkthrough,
  } = useWalkthrough();
  const walkthroughCompletedSteps = walkthroughState.completedSteps.filter(
    (step) => step !== "done",
  );
  const totalWalkthroughSteps = WALKTHROUGH_STEPS.filter((step) => step !== "done").length;
  const isWalkthroughDone = walkthroughState.currentStep === "done";
  const walkthroughButtonLabel = walkthroughState.isActive
    ? "Walkthrough active"
    : isWalkthroughDone
      ? "Restart walkthrough"
      : walkthroughCompletedSteps.length > 0 || walkthroughState.isDismissed
        ? "Resume walkthrough"
        : "Start walkthrough";
  const walkthroughStatusMessage = walkthroughState.isActive
    ? "The walkthrough is currently open."
    : isWalkthroughDone
      ? "You’ve completed the walkthrough. Restart it to see the tour again."
      : walkthroughCompletedSteps.length > 0
        ? `You’ve finished ${walkthroughCompletedSteps.length} of ${totalWalkthroughSteps} steps. Resume to continue where you left off.`
        : "Start the guided tour to explore Flux’s key features.";

  const handleLaunchWalkthrough = useCallback(() => {
    if (walkthroughState.isActive) {
      return;
    }

    if (isWalkthroughDone) {
      resetWalkthrough();
      startWalkthrough();
      return;
    }

    if (walkthroughCompletedSteps.length > 0 || walkthroughState.isDismissed) {
      resumeWalkthrough();
      return;
    }

    startWalkthrough();
  }, [
    isWalkthroughDone,
    resetWalkthrough,
    startWalkthrough,
    resumeWalkthrough,
    walkthroughCompletedSteps.length,
    walkthroughState.isActive,
    walkthroughState.isDismissed,
  ]);

  const loadBlockedUsers = useCallback(async () => {
    if (!user) {
      setBlockedUsers([]);
      return;
    }

    setIsBlockedUsersLoading(true);
    try {
      const blockedIds = await getBlockedUserIds(user.id);
      if (blockedIds.length === 0) {
        setBlockedUsers([]);
        return;
      }

      const uniqueIds = Array.from(new Set(blockedIds));
      const entries = await Promise.all(
        uniqueIds.map(async (blockedId) => {
          const stored = (await get<NetworkUser>("users", blockedId)) ?? null;
          if (stored) {
            return {
              id: stored.id,
              username: stored.username,
              displayName: stored.displayName,
              avatarRef: stored.profile?.avatarRef,
            };
          }

          return {
            id: blockedId,
            username: blockedId,
          };
        })
      );

      setBlockedUsers(
        entries.sort((a, b) => {
          const aLabel = a.displayName || a.username;
          const bLabel = b.displayName || b.username;
          return aLabel.localeCompare(bLabel);
        })
      );
    } catch (error) {
      console.error("[Settings] Failed to load blocked users:", error);
      toast.error("Failed to load blocked users");
      setBlockedUsers([]);
    } finally {
      setIsBlockedUsersLoading(false);
    }
  }, [user]);

  const handleUnblockUser = useCallback(
    async (blockedId: string) => {
      if (!user) return;

      setUnblockingUserId(blockedId);
      try {
        await unblockUser(user.id, blockedId);
        toast.success("User unblocked");
        setBlockedUsers((prev) => prev.filter((entry) => entry.id !== blockedId));
        window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
      } catch (error) {
        console.error("[Settings] Failed to unblock user:", error);
        toast.error("Failed to unblock user");
      } finally {
        setUnblockingUserId(null);
      }
    },
    [user]
  );

  useEffect(() => {
    setUser(getCurrentUser());
  }, []);

  useEffect(() => {
    void loadBlockedUsers();
  }, [loadBlockedUsers]);

  useEffect(() => {
    let isActive = true;

    if (user) {
      setStoredAccounts([]);
      return () => {
        isActive = false;
      };
    }

    setIsLoadingStoredAccounts(true);

    getStoredAccounts()
      .then((accounts) => {
        if (!isActive) return;
        const sorted = [...accounts].sort((a, b) => {
          const aLabel = a.displayName || a.username;
          const bLabel = b.displayName || b.username;
          return aLabel.localeCompare(bLabel);
        });
        setStoredAccounts(sorted);
      })
      .catch((error) => {
        console.error("[Settings] Failed to load stored accounts:", error);
        if (!isActive) return;
        setStoredAccounts([]);
      })
      .finally(() => {
        if (!isActive) return;
        setIsLoadingStoredAccounts(false);
      });

    return () => {
      isActive = false;
    };
  }, [user]);
  
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      toast.error("Username is required");
      return;
    }
    
    setLoading(true);
    try {
      const newUser = await createLocalAccount(
        username.trim(),
        displayName.trim() || username.trim(),
        passphrase || undefined
      );
      setUser(newUser);
      toast.success("Account created successfully!");
      navigate("/");
    } catch (error) {
      toast.error("Failed to create account");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleExportBackup = async () => {
    try {
      const backup = await exportAccountBackup();
      const blob = new Blob([backup], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `imagination-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded successfully");
    } catch (error) {
      toast.error("Failed to export backup");
      console.error(error);
    }
  };
  
  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const imported = await importAccountBackup(text);
      setUser(imported);
      toast.success("Account imported successfully!");
      navigate("/");
    } catch (error) {
      toast.error("Failed to import backup");
      console.error(error);
    }
  };

  const handleRestoreAccount = async (accountId: string) => {
    setRestoringAccountId(accountId);
    try {
      const restored = await restoreLocalAccount(accountId);
      if (!restored) {
        toast.error("Unable to restore that account");
        return;
      }

      setUser(restored);
      toast.success(
        restored.displayName ? `Welcome back, ${restored.displayName}!` : "Account restored successfully!"
      );
      navigate("/");
    } catch (error) {
      console.error("[Settings] Failed to restore account:", error);
      toast.error("Failed to restore account");
    } finally {
      setRestoringAccountId(null);
    }
  };

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-2xl space-y-6">
          {storedAccounts.length > 0 && (
            <Card className="w-full p-8 shadow-glow">
              <div className="text-center mb-8">
                <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-4 shadow-glow">
                  <Key className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Welcome Back</h2>
                <p className="text-muted-foreground">
                  Choose one of your existing local identities to continue.
                </p>
              </div>

              {isLoadingStoredAccounts ? (
                <p className="text-sm text-center text-muted-foreground">Checking saved accounts...</p>
              ) : (
                <div className="space-y-3">
                  {storedAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="text-left">
                        <p className="font-semibold text-sm">
                          {account.displayName || account.username}
                        </p>
                        {account.displayName && (
                          <p className="text-xs text-muted-foreground">@{account.username}</p>
                        )}
                      </div>
                      <Button
                        className="w-full sm:w-auto"
                        onClick={() => void handleRestoreAccount(account.id)}
                        disabled={restoringAccountId === account.id}
                      >
                        {restoringAccountId === account.id ? "Restoring..." : "Use this account"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground mt-4 text-center">
                Accounts are stored securely on this device. Restoring will unlock your existing workspace.
              </p>
            </Card>
          )}

          <Card className="w-full p-8 shadow-glow">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-4 shadow-glow">
                <Shield className="w-8 h-8" />
              </div>
              <h1 className="text-3xl font-bold mb-2">Create Your Identity</h1>
              <p className="text-muted-foreground">
                Your keys are generated locally and never leave your device
              </p>
            </div>

            <Alert className="mb-6 border-accent/50 bg-accent/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Important:</strong> Without a backup, losing your device means losing your
                account. We cannot recover it for you.
              </AlertDescription>
            </Alert>

            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username *</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="alice"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alice Q"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="passphrase">Passphrase (optional but recommended)</Label>
                <Input
                  id="passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter a strong passphrase"
                />
                <p className="text-xs text-muted-foreground">
                  Used to encrypt your private key locally
                </p>
              </div>

              <Button
                type="submit"
                className="w-full gradient-primary shadow-glow"
                disabled={loading}
              >
                {loading ? "Creating..." : "Create Account"}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-sm text-center text-muted-foreground mb-4">
                Already have a backup?
              </p>
              <Label htmlFor="import" className="cursor-pointer">
                <div className="flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors">
                  <Upload className="w-4 h-4" />
                  <span>Import Backup</span>
                </div>
                <Input
                  id="import"
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleImportBackup}
                />
              </Label>
            </div>
          </Card>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-3 pb-20 pt-10 md:px-6">
        <header className="space-y-4 text-center">
          <h1 className="text-3xl font-display font-bold uppercase tracking-[0.24em] text-foreground md:text-4xl">
            Settings
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-foreground/70 md:text-base">
            Tune your identity, security, and backup preferences for the imagination network.
          </p>
        </header>

        <section>
          <Tabs defaultValue="account" className="w-full space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="account" className="gap-2">
                <User className="h-4 w-4" />
                Account
              </TabsTrigger>
              <TabsTrigger value="security" className="gap-2">
                <Shield className="h-4 w-4" />
                Security
              </TabsTrigger>
              <TabsTrigger value="keys" className="gap-2">
                <Key className="h-4 w-4" />
                Keys & Backup
              </TabsTrigger>
            </TabsList>

            <TabsContent value="account" className="space-y-6">
              <Card className="p-6">
                <h2 className="mb-4 text-xl font-bold">Account Information</h2>
                <div className="space-y-4">
                  <div>
                    <Label>Username</Label>
                    <Input value={user.username} disabled />
                  </div>
                  <div>
                    <Label>Display Name</Label>
                    <Input value={user.displayName || ""} disabled />
                  </div>
                  <div>
                    <Label>User ID</Label>
                    <Input value={user.id} disabled className="font-mono text-xs" />
                  </div>
                </div>
              </Card>

              <Card className="space-y-4 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">Blocked users</h2>
                    <p className="text-sm text-muted-foreground">
                      Manage who you have blocked from appearing in your feeds.
                    </p>
                  </div>
                  {blockedUsers.length > 0 && !isBlockedUsersLoading ? (
                    <span className="text-sm text-muted-foreground">
                      {blockedUsers.length} blocked
                    </span>
                  ) : null}
                </div>

                {isBlockedUsersLoading ? (
                  <p className="text-sm text-muted-foreground">Loading blocked users…</p>
                ) : blockedUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    You haven&apos;t blocked anyone yet.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {blockedUsers.map((blocked) => (
                      <li key={blocked.id} className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar
                            avatarRef={blocked.avatarRef}
                            username={blocked.username}
                            displayName={blocked.displayName}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {blocked.displayName || blocked.username}
                            </p>
                            <p className="truncate text-sm text-muted-foreground">@{blocked.username}</p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => {
                            void handleUnblockUser(blocked.id);
                          }}
                          disabled={unblockingUserId === blocked.id}
                        >
                          {unblockingUserId === blocked.id ? "Unblocking…" : "Unblock"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="space-y-4 p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold">Flux walkthrough</h2>
                    <p className="text-sm text-muted-foreground">
                      Reopen the guided tour whenever you want a refresher.
                    </p>
                  </div>
                  <Button
                    className="w-full gap-2 sm:w-auto"
                    onClick={handleLaunchWalkthrough}
                    disabled={walkthroughState.isActive}
                  >
                    <Sparkles className="h-4 w-4" />
                    {walkthroughButtonLabel}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{walkthroughStatusMessage}</p>
              </Card>
            </TabsContent>

            <TabsContent value="security" className="space-y-6">
              <Alert className="border-accent/50 bg-accent/10">
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  Your identity keys are stored locally and encrypted. All data is encrypted
                  before storage and ready for P2P distribution.
                </AlertDescription>
              </Alert>

              <Card className="p-6">
                <h2 className="mb-4 text-xl font-bold">Encryption Status</h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span>Local Encryption</span>
                    <span className="font-medium text-green-500">Active</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Key Algorithm</span>
                    <span className="font-mono text-sm">ECDH P-256 + AES-GCM</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>P2P Ready</span>
                    <span className="text-accent font-medium">Yes</span>
                  </div>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="keys" className="space-y-6">
              <Alert className="border-destructive/50 bg-destructive/10">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Critical:</strong> Export your backup and store it safely. Without it,
                  losing this device means permanently losing access to your account.
                </AlertDescription>
              </Alert>

              <Card className="p-6">
                <h2 className="mb-4 text-xl font-bold">Backup & Recovery</h2>
                <div className="space-y-4">
                  <div>
                    <p className="mb-4 text-sm text-muted-foreground">
                      Your backup contains your encrypted identity keys. Store it in a safe place
                      like a password manager or encrypted drive.
                    </p>
                    <Button onClick={handleExportBackup} className="gap-2" variant="outline">
                      <Download className="h-4 w-4" />
                      Export Encrypted Backup
                    </Button>
                  </div>
                  <AccountExportModal />
                </div>
              </Card>

              <Card className="p-6">
                <h2 className="mb-4 text-xl font-bold">Public Key</h2>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Share this with others to receive encrypted messages
                  </p>
                  <Input value={user.publicKey} disabled className="font-mono text-xs" />
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
};

export default Settings;
