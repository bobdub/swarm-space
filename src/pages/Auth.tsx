import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createLocalAccount,
  restoreLocalAccount,
  getStoredAccounts,
  loginUser,
  logoutUser,
  type UserMeta,
} from "@/lib/auth";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

export default function Auth() {
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [storedAccounts, setStoredAccounts] = useState<UserMeta[]>([]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";

  useEffect(() => {
    loadStoredAccounts();
  }, []);

  const loadStoredAccounts = async () => {
    const accounts = await getStoredAccounts();
    setStoredAccounts(accounts);
  };

  const handleSignUp = async (e: React.FormEvent) => {
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

    setIsLoading(true);

    try {
      await createLocalAccount(
        username.trim(),
        displayName.trim() || username.trim(),
        normalizedPassword
      );

      toast.success("Account created successfully!");
      setPassword("");
      navigate(redirectTo);
    } catch (error) {
      console.error("Sign up error:", error);
      toast.error("Failed to create account. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedAccount) {
      toast.error("Please select an account");
      return;
    }

    const normalizedPassword = signInPassword.trim();

    if (!normalizedPassword) {
      toast.error("Password is required");
      return;
    }

    setIsLoading(true);

    try {
      await restoreLocalAccount(selectedAccount);
      await loginUser(normalizedPassword);
      toast.success("Signed in successfully!");
      setSignInPassword("");
      navigate(redirectTo);
    } catch (error) {
      console.error("Sign in error:", error);
      logoutUser();
      toast.error("Failed to sign in. Please check your password and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-background via-primary/5 to-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-display">Welcome to Imagination Network</CardTitle>
          <CardDescription>
            Create a new account or sign in with an existing one
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signup" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
              <TabsTrigger value="signin">Sign In</TabsTrigger>
            </TabsList>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username *</Label>
                  <Input
                    id="username"
                    placeholder="Choose a username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name (optional)</Label>
                  <Input
                    id="displayName"
                    placeholder="How others will see you"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password *</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Used to encrypt your private key"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Use at least 8 characters. This password encrypts your local private key, and there is no recovery if it is lost.
                  </p>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating Account...
                    </>
                  ) : (
                    "Create Account"
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signin">
              {storedAccounts.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">
                    No accounts found on this device
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => document.querySelector<HTMLButtonElement>('[value="signup"]')?.click()}
                  >
                    Create New Account
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="account">Select Account</Label>
                    <select
                      id="account"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={selectedAccount}
                      onChange={(e) => setSelectedAccount(e.target.value)}
                      disabled={isLoading}
                      required
                    >
                      <option value="">Choose an account...</option>
                      {storedAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.displayName || account.username}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password *</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder="Unlock your private key"
                      value={signInPassword}
                      onChange={(e) => setSignInPassword(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing In...
                      </>
                    ) : (
                      "Sign In"
                    )}
                  </Button>
                </form>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
