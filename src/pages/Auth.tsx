import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  getStoredAccounts,
  restoreLocalAccount,
  recoverAccountFromPrivateKey,
  type UserMeta,
} from "@/lib/auth";
import { setFeatureFlag } from "@/config/featureFlags";
import { updateConnectionState } from "@/lib/p2p/connectionState";
import { toast } from "sonner";
import { Loader2, Key, Shield, UserPlus, Gift, History } from "lucide-react";
import { usePreview } from "@/contexts/PreviewContext";
import { useAuth } from "@/hooks/useAuth";
import { SignupWizard } from "@/components/onboarding/SignupWizard";

export default function Auth() {
  const [isLoading, setIsLoading] = useState(false);
  const [checkingAccounts, setCheckingAccounts] = useState(true);
  const [storedAccounts, setStoredAccounts] = useState<UserMeta[]>([]);
  const [signupOpen, setSignupOpen] = useState(false);

  const [recoveryPrivateKey, setRecoveryPrivateKey] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";
  const { pendingReferral, processReferralAfterSignup } = usePreview();
  const { user, isLoading: authLoading } = useAuth();

  const isReferralSignup = !!pendingReferral;

  const normalizedAccounts = useMemo(() => {
    const seen = new Set<string>();
    const ordered: UserMeta[] = [];
    for (const account of storedAccounts) {
      if (!seen.has(account.id)) {
        ordered.push(account);
        seen.add(account.id);
      }
    }
    return ordered;
  }, [storedAccounts]);

  useEffect(() => {
    if (authLoading) return;
    if (user) {
      navigate(redirectTo, { replace: true });
    }
  }, [authLoading, user, navigate, redirectTo]);

  useEffect(() => {
    let cancelled = false;
    const loadAccounts = async () => {
      try {
        const accounts = await getStoredAccounts();
        if (!cancelled) setStoredAccounts(accounts);
      } finally {
        if (!cancelled) setCheckingAccounts(false);
      }
    };
    loadAccounts();
    return () => { cancelled = true; };
  }, []);

  const handleRestore = async (accountId: string) => {
    setIsLoading(true);
    try {
      const restored = await restoreLocalAccount(accountId);
      if (!restored) {
        toast.error("Unable to restore that identity.");
        return;
      }

      // Restore network mode feature flag from unified state
      const storedMode = localStorage.getItem("flux_network_mode");
      const isBuilder = storedMode === "builder";
      setFeatureFlag("swarmMeshMode", !isBuilder);
      updateConnectionState({
        enabled: true,
        mode: isBuilder ? 'builder' : 'swarm',
      });

      toast.success(`Welcome back, ${restored.displayName ?? restored.username}!`);

      // Trigger P2P auto-enable
      window.dispatchEvent(new CustomEvent("user-login"));

      navigate(redirectTo);
    } catch (error) {
      console.error("Restore error:", error);
      toast.error("Failed to restore account.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignupComplete = async (newUser: UserMeta) => {
    setSignupOpen(false);
    if (isReferralSignup) {
      await processReferralAfterSignup(newUser.id);
      toast.success("Welcome to the network! You joined via invite.");
    }
    navigate(redirectTo);
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryPrivateKey.trim()) {
      toast.error("Private key is required");
      return;
    }
    const normalizedPassword = recoveryPassword.trim();
    if (!normalizedPassword || normalizedPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setIsLoading(true);
    try {
      await recoverAccountFromPrivateKey(recoveryPrivateKey.trim(), normalizedPassword);
      toast.success("Account recovered successfully!");
      setRecoveryPrivateKey("");
      setRecoveryPassword("");
      navigate(redirectTo);
    } catch (error) {
      console.error("Recovery error:", error);
      toast.error("Failed to recover account. Check your private key.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-background via-primary/5 to-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-display flex items-center gap-2">
            {isReferralSignup ? (
              <>
                <Gift className="h-6 w-6 text-primary" />
                You've Been Invited!
              </>
            ) : (
              "Welcome to Imagination Network"
            )}
          </CardTitle>
          <CardDescription>
            {isReferralSignup
              ? "Someone shared content with you. Create an account to explore."
              : "Local-first identity. No servers. No traditional login."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {normalizedAccounts.length > 0 && (
            <Alert className="mb-4">
              <History className="h-4 w-4" />
              <AlertDescription className="space-y-3">
                <div>
                  <strong>Existing identities found.</strong> Pick one to continue.
                </div>
                <div className="space-y-2">
                  {normalizedAccounts.map((account) => (
                    <div key={account.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {account.displayName ?? account.username}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">@{account.username}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRestore(account.id)}
                        disabled={isLoading || checkingAccounts}
                      >
                        Continue
                      </Button>
                    </div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {checkingAccounts && (
            <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking for saved identities…
            </div>
          )}

          {isReferralSignup && (
            <Alert className="mb-4 border-primary/50 bg-primary/10">
              <UserPlus className="h-4 w-4 text-primary" />
              <AlertDescription>
                Sign up to view the shared content and join the network!
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="create" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create">
                {isReferralSignup ? "Join Network" : "Create Account"}
              </TabsTrigger>
              <TabsTrigger value="recover">Recover Account</TabsTrigger>
            </TabsList>

            <TabsContent value="create">
              <div className="space-y-4 pt-2">
                <p className="text-sm text-muted-foreground">
                  Set up your encrypted identity with username, password, network preference, and a backup recovery phrase.
                </p>
                <Button
                  onClick={() => setSignupOpen(true)}
                  disabled={isLoading || checkingAccounts}
                  className="w-full"
                >
                  {isReferralSignup ? "Join Network" : "Create Account"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="recover">
              <Alert className="mb-4">
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  <strong>Account Recovery:</strong> Recover your account using your backup passphrase or private key.
                </AlertDescription>
              </Alert>

              <form onSubmit={handleRecover} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="privateKey" className="flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    Recovery Passphrase or Private Key *
                  </Label>
                  <Input
                    id="privateKey"
                    type="password"
                    placeholder="Enter your backup passphrase or private key"
                    value={recoveryPrivateKey}
                    onChange={(e) => setRecoveryPrivateKey(e.target.value)}
                    disabled={isLoading}
                    required
                    className="font-mono text-xs"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="recovery-password">New Password *</Label>
                  <Input
                    id="recovery-password"
                    type="password"
                    placeholder="Set a password to encrypt your key"
                    value={recoveryPassword}
                    onChange={(e) => setRecoveryPassword(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Min 8 characters. Encrypts your private key locally.
                  </p>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading || checkingAccounts}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Recovering…
                    </>
                  ) : (
                    "Recover Account"
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Multi-step signup wizard */}
      <SignupWizard
        open={signupOpen}
        onComplete={handleSignupComplete}
        onDismiss={() => setSignupOpen(false)}
      />
    </div>
  );
}
