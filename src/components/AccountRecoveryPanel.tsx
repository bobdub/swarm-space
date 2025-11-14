import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Key, Copy, Eye, EyeOff, Shield } from "lucide-react";
import { exportPrivateKey } from "@/lib/auth";
import { toast } from "sonner";
import { useP2P } from "@/hooks/useP2P";

export function AccountRecoveryPanel() {
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { getPeerId } = useP2P();
  const peerId = getPeerId();

  const handleExportPrivateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password.trim()) {
      toast.error("Password is required");
      return;
    }

    setIsLoading(true);

    try {
      const key = await exportPrivateKey(password.trim());
      setPrivateKey(key);
      setPassword("");
      toast.success("Private key exported successfully");
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export private key. Check your password.");
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <div className="space-y-6">
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          <strong>Stage One Recovery:</strong> Use your private key and PeerID to transfer your account to a new device. Keep these secure and never share them publicly.
        </AlertDescription>
      </Alert>

      {/* PeerID Display */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Key className="h-5 w-5" />
              Your PeerID
            </h3>
            <p className="text-sm text-muted-foreground">
              Your unique identifier on the P2P network
            </p>
          </div>
        </div>

        {peerId ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 p-3 bg-muted rounded-md text-xs font-mono break-all">
                {peerId}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(peerId, "PeerID")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            PeerID will be available when P2P is enabled
          </p>
        )}
      </Card>

      {/* Private Key Export */}
      <Card className="p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Key className="h-5 w-5" />
            Export Private Key
          </h3>
          <p className="text-sm text-muted-foreground">
            Required for account recovery on new devices
          </p>
        </div>

        {!privateKey ? (
          <form onSubmit={handleExportPrivateKey} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="export-password">Confirm Password</Label>
              <Input
                id="export-password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Exporting..." : "Export Private Key"}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <Alert className="border-accent/50 bg-accent/10">
              <AlertDescription>
                <strong>Warning:</strong> Anyone with this key can access your account. Store it securely.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Private Key</Label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? (
                    <><EyeOff className="h-4 w-4 mr-1" /> Hide</>
                  ) : (
                    <><Eye className="h-4 w-4 mr-1" /> Show</>
                  )}
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <code className="flex-1 p-3 bg-muted rounded-md text-xs font-mono break-all">
                  {showKey ? privateKey : "••••••••••••••••••••••••"}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(privateKey, "Private key")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <Button
              variant="outline"
              onClick={() => setPrivateKey(null)}
            >
              Clear
            </Button>
          </div>
        )}
      </Card>

      <Alert>
        <AlertDescription className="text-xs">
          <strong>How to recover:</strong>
          <ol className="list-decimal ml-4 mt-2 space-y-1">
            <li>On your new device, navigate to the Auth page</li>
            <li>Select "Recover Account"</li>
            <li>Enter your private key and set a new password</li>
            <li>Your account will be transferred to the new device</li>
          </ol>
        </AlertDescription>
      </Alert>
    </div>
  );
}
