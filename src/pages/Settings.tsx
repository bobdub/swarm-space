import { TopNavigationBar } from "@/components/TopNavigationBar";
import { StorageHealthIndicator } from "@/components/StorageHealthIndicator";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  Key,
  Upload,
  User,
  AlertTriangle,
  Sparkles,
  Gamepad2,
  LogOut,
  FileText,
  BookOpen,
  Lock,
  ChevronRight,
  Github,
  HardDrive,
  Brain,
  Box,
  Trash2,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import {
  getCurrentUser,
  createLocalAccount,
  exportAccountBackup,
  importAccountBackup,
  getStoredAccounts,
  restoreLocalAccount,
  logoutUser,
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
import { VerificationModal } from "@/components/verification/VerificationModal";
import { AccountRecoveryPanel } from "@/components/AccountRecoveryPanel";
import { StorageTargetsPanel } from "@/components/settings/StorageTargetsPanel";

const Settings = () => {
  const [user, setUser] = useState(getCurrentUser());
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
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
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!user) {
      navigate("/auth?redirect=/settings");
    }
  }, [user, navigate]);
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
        : "Start the guided tour to explore Swarm Space's key features.";

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
    
    const normalizedPassword = password.trim();

    if (!normalizedPassword) {
      toast.error("Password is required");
      return;
    }

    if (normalizedPassword.length < 8) {
      toast.error("Password must be at least 8 characters long");
      return;
    }

    setLoading(true);
    try {
      const newUser = await createLocalAccount(
        username.trim(),
        displayName.trim() || username.trim(),
        normalizedPassword
      );
      setUser(newUser);
      setPassword("");
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
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Use at least 8 characters"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  This password encrypts your private key locally. Keep it safe—there is no recovery option.
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
      {user && (
        <VerificationModal
          open={practiceOpen}
          userId={user.id}
          isNewUser={false}
          sandbox
          onComplete={() => setPracticeOpen(false)}
          onSkip={() => setPracticeOpen(false)}
        />
      )}
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-3 pb-20 pt-10 md:px-6">
        <header className="space-y-4 text-center md:text-left">
          <h1 className="text-3xl font-bold font-display uppercase tracking-[0.24em]">Settings</h1>
          <p className="text-sm text-foreground/70">
            Configure your identity, manage security, and keep backups of your keys across the mesh.
          </p>
          <StorageHealthIndicator />
        </header>

        <section className="space-y-6">
          <Tabs defaultValue="account" className="w-full space-y-6">
            <TabsList className="grid w-full grid-cols-4 gap-2 rounded-2xl border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.55)] p-1">
              <TabsTrigger
                value="account"
                className="gap-2 rounded-xl data-[state=active]:bg-[hsla(326,71%,62%,0.18)] data-[state=active]:text-foreground"
              >
                <User className="h-4 w-4" />
                Account
              </TabsTrigger>
              <TabsTrigger
                value="security"
                className="gap-2 rounded-xl data-[state=active]:bg-[hsla(326,71%,62%,0.18)] data-[state=active]:text-foreground"
              >
                <Shield className="h-4 w-4" />
                Security
              </TabsTrigger>
              <TabsTrigger
                value="storage"
                className="gap-2 rounded-xl data-[state=active]:bg-[hsla(326,71%,62%,0.18)] data-[state=active]:text-foreground"
              >
                <HardDrive className="h-4 w-4" />
                Storage
              </TabsTrigger>
              <TabsTrigger
                value="keys"
                className="gap-2 rounded-xl data-[state=active]:bg-[hsla(326,71%,62%,0.18)] data-[state=active]:text-foreground"
              >
                <Key className="h-4 w-4" />
                Keys
              </TabsTrigger>
            </TabsList>

            <TabsContent value="account" className="space-y-6">
              <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
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

              <Card className="space-y-4 rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">Blocked users</h2>
                    <p className="text-sm text-foreground/60">
                      Manage who you have blocked from appearing in your feeds.
                    </p>
                  </div>
                  {blockedUsers.length > 0 && !isBlockedUsersLoading ? (
                    <span className="text-sm text-foreground/60">{blockedUsers.length} blocked</span>
                  ) : null}
                </div>

                {isBlockedUsersLoading ? (
                  <p className="text-sm text-foreground/60">Loading blocked users…</p>
                ) : blockedUsers.length === 0 ? (
                  <p className="text-sm text-foreground/60">You haven&apos;t blocked anyone yet.</p>
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
                            <p className="truncate font-medium">{blocked.displayName || blocked.username}</p>
                            <p className="truncate text-sm text-foreground/50">@{blocked.username}</p>
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

              <Card className="space-y-4 rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold">Imagination walkthrough</h2>
                    <p className="text-sm text-foreground/60">
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
                <p className="text-xs text-foreground/50">{walkthroughStatusMessage}</p>
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

              <Card className="space-y-4 rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold">Practice Dream Match</h2>
                    <p className="text-sm text-foreground/60">
                      Try the verification flow without saving results, medals, or credits.
                    </p>
                  </div>
                  <Button
                    className="w-full gap-2 sm:w-auto"
                    onClick={() => setPracticeOpen(true)}
                    disabled={!user}
                  >
                    <Gamepad2 className="h-4 w-4" />
                    Start practice
                  </Button>
                </div>
                <p className="text-xs text-foreground/50">
                  Sandbox runs are local only—perfect for rehearsing before you verify for real.
                </p>
              </Card>

              <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
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
                    <span className="font-medium text-accent">Yes</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Three-Factor Recovery</span>
                    <span className="font-medium text-green-500">Enabled</span>
                  </div>
                </div>
              </Card>

            </TabsContent>

            <TabsContent value="storage" className="space-y-6">
              <StorageTargetsPanel />
            </TabsContent>

            <TabsContent value="keys" className="space-y-6">
              <Alert className="border-[hsla(174,59%,56%,0.4)] bg-[hsla(174,59%,56%,0.08)]">
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  Your account is protected by <strong>Three-Factor Recovery</strong>: a Recovery Key
                  (<code className="text-xs">SWRM-XXXX</code>), a Recovery Phrase, and your Account
                  Password. All three are required to restore your identity on a new device — intercepting
                  any single one is useless.
                </AlertDescription>
              </Alert>

              <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
                <h2 className="mb-4 text-xl font-bold">Three-Factor Recovery</h2>
                <div className="space-y-4">
                  <p className="text-sm text-foreground/60">
                    Your Recovery Key (a short <code className="text-xs">SWRM-XXXX</code> code) locates
                    your encrypted backup on the mesh. Your Recovery Phrase salts the encryption.
                    Your Account Password unlocks the payload. Keep all three safe — losing any one
                    breaks recovery.
                  </p>
                  <div className="flex items-start gap-3 rounded-lg border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.5)] p-3">
                    <Shield className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(174,59%,56%)]" />
                    <p className="text-xs leading-relaxed text-foreground/70">
                      <strong className="text-foreground">Tip:</strong> Download your Recovery Key and
                      write your Phrase down — store them separately from your password (a password
                      manager plus a physical lockbox works well). Nothing is stored on the network
                      in plaintext.
                    </p>
                  </div>
                  <AccountRecoveryPanel />
                </div>
              </Card>

              <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
                <h2 className="mb-4 text-xl font-bold">Public Key</h2>
                <div className="space-y-2">
                  <p className="text-sm text-foreground/60">
                    Your public key is shared with peers for content verification and encrypted messaging.
                  </p>
                  <Input value={user.publicKey} disabled className="font-mono text-xs" />
                  <p className="text-xs text-foreground/40">
                    This key is derived from your identity and cannot be changed.
                  </p>
                </div>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Logout */}
          <Card className="rounded-3xl border border-destructive/30 bg-destructive/5 p-6 mt-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-destructive">Sign Out</h2>
                <p className="text-sm text-foreground/60">
                  Log out of your current account. Your data stays on this device.
                </p>
              </div>
              <Button
                variant="destructive"
                className="gap-2"
                onClick={() => {
                  logoutUser();
                  navigate("/auth");
                }}
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
            </div>
          </Card>

          {/* Danger Zone — irreversible local data wipe */}
          <Card className="rounded-3xl border-2 border-destructive/50 bg-destructive/10 p-6 mt-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <h2 className="text-lg font-bold text-destructive">Danger Zone</h2>
                  <p className="text-sm text-foreground/70">
                    Deleting your account wipes every local key, message, draft, and cached chunk
                    on this device. Your peer-id will simply disappear from the mesh as other peers
                    prune you. <strong>This cannot be undone</strong> — export a backup first if you
                    want to come back later.
                  </p>
                </div>
              </div>
              {!deleteOpen ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="destructive"
                    className="gap-2"
                    onClick={() => { setDeleteOpen(true); setDeleteConfirm(""); }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Account
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-destructive/40 bg-background/40 p-4">
                  <Label htmlFor="delete-confirm" className="text-sm">
                    Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm:
                  </Label>
                  <Input
                    id="delete-confirm"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE"
                    autoComplete="off"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { setDeleteOpen(false); setDeleteConfirm(""); }}
                      disabled={deleting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deleteConfirm !== "DELETE" || deleting}
                      onClick={async () => {
                        setDeleting(true);
                        try {
                          // 1. Wipe localStorage + sessionStorage entirely.
                          try { localStorage.clear(); } catch { /* ignore */ }
                          try { sessionStorage.clear(); } catch { /* ignore */ }
                          // 2. Drop every IndexedDB owned by this origin (best-effort).
                          try {
                            if (typeof indexedDB !== "undefined" && "databases" in indexedDB) {
                              const dbs = await (indexedDB as IDBFactory & { databases: () => Promise<{ name?: string }[]> }).databases();
                              await Promise.all(
                                dbs.map(({ name }) =>
                                  name
                                    ? new Promise<void>((resolve) => {
                                        const req = indexedDB.deleteDatabase(name);
                                        req.onsuccess = () => resolve();
                                        req.onerror = () => resolve();
                                        req.onblocked = () => resolve();
                                      })
                                    : Promise.resolve(),
                                ),
                              );
                            }
                          } catch { /* ignore */ }
                          // 3. Surface any caches.
                          try {
                            if (typeof caches !== "undefined") {
                              const keys = await caches.keys();
                              await Promise.all(keys.map((k) => caches.delete(k)));
                            }
                          } catch { /* ignore */ }
                          toast.success("Account deleted — redirecting…");
                          // Hard-reload to a clean origin so React state and
                          // every singleton are torn down with the data.
                          setTimeout(() => { window.location.replace("/"); }, 400);
                        } catch (err) {
                          console.error("[Settings] delete failed:", err);
                          toast.error("Delete failed — try again");
                          setDeleting(false);
                        }
                      }}
                    >
                      {deleting ? "Deleting…" : "Permanently delete"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Reference Links */}
          <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6 mt-6">
            <h2 className="text-lg font-bold mb-1">Legal & Documentation</h2>
            <p className="text-sm text-foreground/50 mb-4">Learn more about the network, your rights, and how we protect your data.</p>
            <div className="space-y-2">
              {[
                { icon: FileText, label: "Terms of Service", desc: "Terms, cookies & usage policies", path: "/terms" },
                { icon: BookOpen, label: "Whitepaper", desc: "Neural network, blockchain & technical architecture", path: "/whitepaper" },
                { icon: Lock, label: "Privacy", desc: "Encryption standards & how your data is protected", path: "/privacy" },
                { icon: Brain, label: "About the Network", desc: "A friendly story explaining how Imagination works", path: "/about-network" },
                { icon: Sparkles, label: "Neural Network Paper", desc: "Technical architecture of the mesh intelligence layer", path: "/neural-network" },
                { icon: Box, label: "Virtual Hub & Builder", desc: "How to walk and build inside 3D project rooms", path: "/about-network#virtual-hub" },
              ].map((item) => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border/30 bg-muted/20 p-3 text-left transition-colors hover:bg-muted/40"
                >
                  <item.icon className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-xs text-foreground/50">{item.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-foreground/30" />
                </button>
              ))}

              {/* GitHub Project Link */}
              <a
                href="https://github.com/bobdub/swarm-space/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center gap-3 rounded-xl border border-border/30 bg-muted/20 p-3 text-left transition-colors hover:bg-muted/40"
              >
                <Github className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">GitHub Project</p>
                  <p className="text-xs text-foreground/50">Source code, docs & contribution guide</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-foreground/30" />
              </a>
            </div>
          </Card>
        </section>
      </main>
    </div>
  );
};

export default Settings;
