import { Navigation } from "@/components/Navigation";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Key, Download, Upload, User, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import { getCurrentUser, createLocalAccount, exportAccountBackup, importAccountBackup } from "@/lib/auth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const Settings = () => {
  const [user, setUser] = useState(getCurrentUser());
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  
  useEffect(() => {
    setUser(getCurrentUser());
  }, []);
  
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
  
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md p-8 shadow-glow">
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
    );
  }
  
  return (
    <div className="flex min-h-screen">
      <Navigation />
      
      <main className="flex-1 ml-64">
        <TopNavigationBar />
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <h1 className="text-3xl font-bold">Settings</h1>
          
          <Tabs defaultValue="account" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="account" className="gap-2">
                <User className="w-4 h-4" />
                Account
              </TabsTrigger>
              <TabsTrigger value="security" className="gap-2">
                <Shield className="w-4 h-4" />
                Security
              </TabsTrigger>
              <TabsTrigger value="keys" className="gap-2">
                <Key className="w-4 h-4" />
                Keys & Backup
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="account" className="space-y-4">
              <Card className="p-6">
                <h2 className="text-xl font-bold mb-4">Account Information</h2>
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
            </TabsContent>
            
            <TabsContent value="security" className="space-y-4">
              <Alert className="border-accent/50 bg-accent/10">
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  Your identity keys are stored locally and encrypted. All data is encrypted
                  before storage and ready for P2P distribution.
                </AlertDescription>
              </Alert>
              
              <Card className="p-6">
                <h2 className="text-xl font-bold mb-4">Encryption Status</h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span>Local Encryption</span>
                    <span className="text-green-500 font-medium">Active</span>
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
            
            <TabsContent value="keys" className="space-y-4">
              <Alert className="border-destructive/50 bg-destructive/10">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Critical:</strong> Export your backup and store it safely. Without it,
                  losing this device means permanently losing access to your account.
                </AlertDescription>
              </Alert>
              
              <Card className="p-6">
                <h2 className="text-xl font-bold mb-4">Backup & Recovery</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-4">
                      Your backup contains your encrypted identity keys. Store it in a safe place
                      like a password manager or encrypted drive.
                    </p>
                    <Button
                      onClick={handleExportBackup}
                      className="gap-2"
                      variant="outline"
                    >
                      <Download className="w-4 h-4" />
                      Export Encrypted Backup
                    </Button>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6">
                <h2 className="text-xl font-bold mb-4">Public Key</h2>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Share this with others to receive encrypted messages
                  </p>
                  <Input
                    value={user.publicKey}
                    disabled
                    className="font-mono text-xs"
                  />
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
};

export default Settings;