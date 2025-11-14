import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  createLocalAccount,
  recoverAccountFromPrivateKey,
  type UserMeta,
} from "@/lib/auth";
import { toast } from "sonner";
import { Loader2, Key, Shield } from "lucide-react";
import { useEffect } from "react";

export default function Auth() {
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryPrivateKey, setRecoveryPrivateKey] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";

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

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!recoveryPrivateKey.trim()) {
      toast.error("Private key is required");
      return;
    }

    const normalizedPassword = recoveryPassword.trim();

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
      await recoverAccountFromPrivateKey(recoveryPrivateKey.trim(), normalizedPassword);
      toast.success("Account recovered successfully!");
      setRecoveryPrivateKey("");
      setRecoveryPassword("");
      navigate(redirectTo);
    } catch (error) {
      console.error("Recovery error:", error);
      toast.error("Failed to recover account. Please check your private key and try again.");
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
            Local-first identity. No servers. No traditional login.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="create" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create">Create Account</TabsTrigger>
              <TabsTrigger value="recover">Recover Account</TabsTrigger>
            </TabsList>

            <TabsContent value="create">
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

            <TabsContent value="recover">
              <Alert className="mb-4">
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  <strong>Stage One Recovery:</strong> Transfer your account using your private key. Find your key in Settings → Security on your existing device.
                </AlertDescription>
              </Alert>

              <form onSubmit={handleRecover} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="privateKey" className="flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    Private Key *
                  </Label>
                  <Input
                    id="privateKey"
                    type="password"
                    placeholder="Paste your private key here"
                    value={recoveryPrivateKey}
                    onChange={(e) => setRecoveryPrivateKey(e.target.value)}
                    disabled={isLoading}
                    required
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Your private key is never transmitted. It stays on your device.
                  </p>
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
                    Use at least 8 characters. This encrypts your private key locally.
                  </p>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Recovering Account...
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
    </div>
  );
}
