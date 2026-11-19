import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  getStoredAccounts,
  restoreLocalAccount,
  type UserMeta,
} from "@/lib/auth";
import { setFeatureFlag } from "@/config/featureFlags";
import { loadConnectionState, updateConnectionState } from "@/lib/p2p/connectionState";
import { toast } from "sonner";
import { Loader2, Key, Shield, UserPlus, Gift, History } from "lucide-react";
import { usePreview } from "@/contexts/PreviewContext";
import { useAuthReady } from "@/hooks/useAuthReady";
import { SignupWizard } from "@/components/onboarding/SignupWizard";
import { resolvePostAuthTarget } from "@/lib/routing/canonicalHome";
import { isGuestUser } from '@/lib/preview/guestAccess';

export default function Auth() {
  const [isLoading, setIsLoading] = useState(false);
  const [checkingAccounts, setCheckingAccounts] = useState(true);
  const [storedAccounts, setStoredAccounts] = useState<UserMeta[]>([]);
  const [signupOpen, setSignupOpen] = useState(() => new URLSearchParams(window.location.search).get('signup') === '1');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const fromPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const requestedRedirect = fromPath || searchParams.get("redirect");
  const { pendingReferral, processReferralAfterSignup } = usePreview();
  const { user, isReady: authReady } = useAuthReady();
  // Single helper — `/` and `/index` collapse to canonical home (/brain) so
  // logged-in users never bounce back to the marketing page after auth.
  const redirectTo = resolvePostAuthTarget(user, requestedRedirect);

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
    if (!authReady) return;
    if (user && !isGuestUser(user)) {
      navigate(redirectTo, { replace: true });
    }
  }, [authReady, user, navigate, redirectTo]);

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

      // Keep feature flags aligned with the unified connection-state store.
      const storedConnection = loadConnectionState();
      const isBuilder = storedConnection.mode === 'builder';
      setFeatureFlag("swarmMeshMode", !isBuilder);
      updateConnectionState({
        enabled: true,
        mode: isBuilder ? 'builder' : 'swarm',
      });

      toast.success(`Welcome back, ${restored.displayName ?? restored.username}!`);

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
    // New accounts must opt the unified connection store into "enabled" so
    // the auto-enable effect in useP2P actually kicks. Without this, the
    // effect bails on `!connectionState.enabled` and the UI stalls forever
    // at "Attempting to establish connectivity." with no peer count.
    try {
      const storedConnection = loadConnectionState();
      const isBuilder = storedConnection.mode === 'builder';
      setFeatureFlag("swarmMeshMode", !isBuilder);
      updateConnectionState({
        enabled: true,
        mode: isBuilder ? 'builder' : 'swarm',
      });
    } catch (error) {
      console.warn("[Auth] Failed to prime connection state after signup", error);
    }
    if (isReferralSignup) {
      await processReferralAfterSignup(newUser.id);
      toast.success("Welcome to the network! You joined via invite.");
    }
    navigate(redirectTo);
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
                  Set up your encrypted identity with a username, password and network preference. Your encrypted recovery vault is sealed automatically.
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
                  <strong>Sovereign Recovery:</strong> open the Recovery Link from your
                  <code className="mx-1 text-xs">swarm-identity-*.md</code> file. It reaches a peer holding your
                  encrypted vault, and your Recovery Passphrase opens it on this device.
                </AlertDescription>
              </Alert>
              <Button className="w-full gap-2" onClick={() => navigate("/recover")} disabled={checkingAccounts}>
                <Key className="h-4 w-4" />
                Recover with a Recovery Link
              </Button>
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
