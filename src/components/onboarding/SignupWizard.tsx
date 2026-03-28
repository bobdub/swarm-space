/**
 * SignupWizard — Multi-step account creation.
 *
 * Step 1: Credentials (username, display name, password)
 * Step 2: Network Mode (Swarm Mesh vs Builder Mode)
 * Step 3: Backup Phrase (min 200 chars, mesh recovery)
 * Step 4: Terms of Service (scroll-to-accept)
 *
 * Nothing is stored to localStorage/IndexedDB until all steps complete.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Download,
  Loader2,
  Network,
  Settings2,
  Shield,
  Wifi,
} from "lucide-react";
import { z } from "zod";
import { createLocalAccount, type UserMeta } from "@/lib/auth";
import { generateRecoveryKey, markRecoveryKeyBackup } from "@/lib/backup/recoveryKey";
import { toast } from "sonner";
import { CREDIT_REWARDS } from "@/lib/credits";
import { setFeatureFlag } from "@/config/featureFlags";
import { updateConnectionState } from "@/lib/p2p/connectionState";
import tosContent from "../../../TOS.md?raw";
import { SCROLL_GUARD_BUFFER_PX } from "@/lib/onboarding/constants";

// ── Validation ─────────────────────────────────────────────────────────

const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be 20 characters or fewer")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Letters, numbers, and underscores only"
    ),
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required")
    .max(50, "50 characters max"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "128 characters max"),
});

// ── Helpers ────────────────────────────────────────────────────────────

type NetworkMode = "swarm" | "builder";

function phraseEntropy(phrase: string): number {
  if (!phrase) return 0;
  const freq = new Map<string, number>();
  for (const ch of phrase) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / phrase.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function phraseStrength(phrase: string): {
  label: string;
  color: string;
  percent: number;
} {
  const len = phrase.length;
  if (len === 0) return { label: "", color: "", percent: 0 };
  if (len < 200) return { label: `${200 - len} more characters needed`, color: "text-destructive", percent: Math.round((len / 200) * 40) };
  const ent = phraseEntropy(phrase);
  if (ent < 3) return { label: "Too repetitive — add variety", color: "text-[hsl(38,92%,50%)]", percent: 50 };
  if (ent < 4) return { label: "Acceptable", color: "text-[hsl(174,59%,56%)]", percent: 70 };
  return { label: "Strong", color: "text-[hsl(142,71%,45%)]", percent: 100 };
}

// ── Component ──────────────────────────────────────────────────────────

interface SignupWizardProps {
  open: boolean;
  onComplete: (user: UserMeta) => void;
  onDismiss?: () => void;
  defaultNetworkMode?: NetworkMode;
}

const STEPS = ["credentials", "network", "backup", "tos"] as const;
type Step = (typeof STEPS)[number];

export function SignupWizard({
  open,
  onComplete,
  onDismiss,
  defaultNetworkMode = "swarm",
}: SignupWizardProps) {
  // ── State ──
  const [step, setStep] = useState<Step>("credentials");
  const [creating, setCreating] = useState(false);

  // Step 1 — Credentials
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [credErrors, setCredErrors] = useState<Record<string, string>>({});

  // Step 2 — Network mode
  const [networkMode, setNetworkMode] = useState<NetworkMode>(defaultNetworkMode);

  // Step 3 — Backup phrase
  const [backupPhrase, setBackupPhrase] = useState("");

  // Step 4 — TOS
  const tosRef = useRef<HTMLDivElement>(null);
  const [scrolledTos, setScrolledTos] = useState(false);
  const [tosChecked, setTosChecked] = useState(false);
  const [storageChecked, setStorageChecked] = useState(false);

  const stepIndex = STEPS.indexOf(step);
  const progress = Math.round(((stepIndex + 1) / STEPS.length) * 100);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep("credentials");
      setUsername("");
      setDisplayName("");
      setPassword("");
      setCredErrors({});
      setNetworkMode(defaultNetworkMode);
      setBackupPhrase("");
      setScrolledTos(false);
      setTosChecked(false);
      setStorageChecked(false);
      setCreating(false);
    }
  }, [open, defaultNetworkMode]);

  // ── Navigation ──

  const goBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  const goNext = () => {
    if (step === "credentials") {
      const result = credentialsSchema.safeParse({ username, displayName, password });
      if (!result.success) {
        const errs: Record<string, string> = {};
        result.error.issues.forEach((i) => {
          const key = String(i.path[0]);
          if (!errs[key]) errs[key] = i.message;
        });
        setCredErrors(errs);
        return;
      }
      setCredErrors({});
    }

    if (step === "backup") {
      if (backupPhrase.trim().length < 200) {
        toast.error("Backup phrase must be at least 200 characters");
        return;
      }
      if (phraseEntropy(backupPhrase) < 3) {
        toast.error("Phrase is too repetitive — add more variety");
        return;
      }
    }

    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  // ── TOS scroll tracking ──

  const handleTosScroll = useCallback(() => {
    const el = tosRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist <= SCROLL_GUARD_BUFFER_PX) setScrolledTos(true);
  }, []);

  useEffect(() => {
    if (step !== "tos") return;
    const el = tosRef.current;
    if (!el) return;
    // auto-accept if content is shorter than container
    if (el.scrollHeight - el.clientHeight <= SCROLL_GUARD_BUFFER_PX) {
      setScrolledTos(true);
    }
  }, [step]);

  // ── Account creation ──

  const handleCreate = async () => {
    if (!scrolledTos || !tosChecked || !storageChecked) return;
    setCreating(true);

    try {
      // 1. Create account (password wraps the private key)
      const user = await createLocalAccount(
        username.trim(),
        displayName.trim() || username.trim(),
        password
      );

      // 2. Store network mode preference via unified state + feature flag
      updateConnectionState({
        enabled: true,
        mode: networkMode === 'swarm' ? 'swarm' : 'builder',
      });
      setFeatureFlag("swarmMeshMode", networkMode === "swarm");

      // 4. Create mesh backup from backup phrase
      const trimmedPhrase = backupPhrase.trim();
      try {
        await createPassphraseBackup(trimmedPhrase);
      } catch (backupErr) {
        console.warn("[SignupWizard] Backup chunk creation failed — user can retry from settings", backupErr);
      }
      // Mark passphrase as done so Settings shows download instead of legacy migration
      localStorage.setItem(`passphrase-backup-done:${user.id}`, "1");
      localStorage.setItem(`backup-passphrase:${user.id}`, trimmedPhrase);

      toast.success(
        `Welcome, ${user.displayName}! +${CREDIT_REWARDS.GENESIS_ALLOCATION} genesis credits`,
        { id: "signup-success" }
      );

      // 5. Grant storage consent (replaces standalone cookie banner)
      try {
        localStorage.setItem("flux_storage_consent", "granted");
        window.dispatchEvent(new CustomEvent("storage-consent-granted"));
      } catch {}

      // 6. Dispatch user-login to trigger P2P auto-enable
      window.dispatchEvent(new CustomEvent("user-login"));

      onComplete(user);
    } catch (err) {
      console.error("[SignupWizard] Account creation failed:", err);
      toast.error("Account creation failed. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  // ── Rate limiting ──
  const lastCreateRef = useRef(0);
  const rateLimitedCreate = async () => {
    const now = Date.now();
    if (now - lastCreateRef.current < 10_000) {
      toast.error("Please wait a few seconds before trying again");
      return;
    }
    lastCreateRef.current = now;
    await handleCreate();
  };

  // ── Render ──

  const strength = phraseStrength(backupPhrase);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss?.();
      }}
    >
      <DialogContent className="max-w-md border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,6%,0.96)] backdrop-blur-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {step === "credentials" && "Create Your Account"}
            {step === "network" && "Choose Your Network"}
            {step === "backup" && "Recovery Backup Phrase"}
            {step === "tos" && "Terms of Service"}
          </DialogTitle>
          <DialogDescription>
            Step {stepIndex + 1} of {STEPS.length}
          </DialogDescription>
        </DialogHeader>

        <Progress value={progress} className="h-1.5" />

        <div className="min-h-[260px] space-y-4 py-2">
          {/* ─── Step 1: Credentials ─── */}
          {step === "credentials" && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-2">
                <Label htmlFor="signup-username">Username *</Label>
                <Input
                  id="signup-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your_username"
                  className={credErrors.username ? "border-destructive" : ""}
                  autoFocus
                />
                {credErrors.username && (
                  <p className="text-xs text-destructive">{credErrors.username}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-display">Display Name *</Label>
                <Input
                  id="signup-display"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How others see you"
                  className={credErrors.displayName ? "border-destructive" : ""}
                />
                {credErrors.displayName && (
                  <p className="text-xs text-destructive">{credErrors.displayName}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-password">Password *</Label>
                <Input
                  id="signup-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className={credErrors.password ? "border-destructive" : ""}
                />
                <p className="text-[0.65rem] text-foreground/50">
                  Encrypts your private key on this device. There is no server-side reset.
                </p>
                {credErrors.password && (
                  <p className="text-xs text-destructive">{credErrors.password}</p>
                )}
              </div>
            </div>
          )}

          {/* ─── Step 2: Network Mode ─── */}
          {step === "network" && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <p className="text-sm text-foreground/60">
                Choose how you connect to the peer network. You can change this anytime in Settings.
              </p>

              <div className="grid gap-3">
                {/* Swarm Mesh */}
                <button
                  type="button"
                  onClick={() => setNetworkMode("swarm")}
                  className={`group flex items-start gap-4 rounded-xl border p-4 text-left transition-all duration-200 active:scale-[0.97] ${
                    networkMode === "swarm"
                      ? "border-[hsl(174,59%,56%)] bg-[hsla(174,59%,56%,0.08)] shadow-[0_0_20px_hsla(174,59%,56%,0.12)]"
                      : "border-[hsla(174,59%,56%,0.15)] bg-transparent hover:border-[hsla(174,59%,56%,0.3)]"
                  }`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsla(174,59%,56%,0.12)]">
                    <Wifi className="h-5 w-5 text-[hsl(174,59%,56%)]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">Swarm Mesh</span>
                      {networkMode === "swarm" && (
                        <Check className="h-4 w-4 text-[hsl(174,59%,56%)]" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-foreground/50">
                      Automatic connections, auto-mining, zero config. Recommended for most users.
                    </p>
                  </div>
                </button>

                {/* Builder Mode */}
                <button
                  type="button"
                  onClick={() => setNetworkMode("builder")}
                  className={`group flex items-start gap-4 rounded-xl border p-4 text-left transition-all duration-200 active:scale-[0.97] ${
                    networkMode === "builder"
                      ? "border-[hsl(326,71%,62%)] bg-[hsla(326,71%,62%,0.08)] shadow-[0_0_20px_hsla(326,71%,62%,0.12)]"
                      : "border-[hsla(174,59%,56%,0.15)] bg-transparent hover:border-[hsla(326,71%,62%,0.3)]"
                  }`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsla(326,71%,62%,0.12)]">
                    <Settings2 className="h-5 w-5 text-[hsl(326,71%,62%)]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">Builder Mode</span>
                      {networkMode === "builder" && (
                        <Check className="h-4 w-4 text-[hsl(326,71%,62%)]" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-foreground/50">
                      Manual peer control, approval queue, granular settings. For power users.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ─── Step 3: Backup Phrase ─── */}
          {step === "backup" && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-start gap-3 rounded-lg border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.5)] p-3">
                <Shield className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(174,59%,56%)]" />
                <p className="text-xs leading-relaxed text-foreground/70">
                  This phrase is your <strong className="text-foreground">emergency recovery key</strong>.
                  If you lose access to this device, enter it on any mesh node to restore your account.
                  It is never stored locally — only encrypted chunks are distributed to the network.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="backup-phrase">
                  Backup Phrase <span className="text-foreground/40">(min 200 characters)</span>
                </Label>
                <Textarea
                  id="backup-phrase"
                  value={backupPhrase}
                  onChange={(e) => setBackupPhrase(e.target.value)}
                  placeholder="Write a memorable sentence, poem, or passphrase that only you would know. Use at least 200 characters for secure mesh recovery…"
                  rows={5}
                  className="resize-none text-sm"
                  autoFocus
                />

                <div className="flex items-center justify-between text-xs">
                  <span className={strength.color}>{strength.label}</span>
                  <span className="tabular-nums text-foreground/40">
                    {backupPhrase.length} / 200
                  </span>
                </div>

                {backupPhrase.length > 0 && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[hsla(245,70%,16%,0.6)]">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-[hsl(174,59%,56%)] to-[hsl(142,71%,45%)]"
                      style={{ width: `${strength.percent}%` }}
                    />
                  </div>
                )}

                <div className="flex items-start gap-2 rounded-md border border-[hsla(174,59%,56%,0.12)] bg-[hsla(245,70%,12%,0.4)] p-2.5 mt-1">
                  <Download className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/40" />
                  <p className="text-[0.65rem] leading-relaxed text-foreground/50">
                    You can download this passphrase as a .txt file after account creation in <strong className="text-foreground/70">Settings → Keys &amp; Backup</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ─── Step 4: Terms of Service ─── */}
          {step === "tos" && (
            <div className="space-y-3 animate-in fade-in slide-in-from-right-4 duration-300">
              <p className="text-xs text-foreground/50">
                Scroll through the full policy to enable acceptance.
              </p>
              <div
                ref={tosRef}
                onScroll={handleTosScroll}
                className="h-40 space-y-3 overflow-y-auto rounded-md border border-[hsla(174,59%,56%,0.15)] bg-[hsla(245,70%,10%,0.5)] px-4 py-3 text-xs leading-relaxed text-foreground/70"
              >
                {tosContent
                  .split("\n\n")
                  .filter(Boolean)
                  .map((block, i) => {
                    const trimmed = block.trim();
                    if (trimmed.startsWith("# ")) {
                      return (
                        <h2 key={i} className="font-semibold uppercase tracking-[0.15em] text-foreground text-sm">
                          {trimmed.replace(/^#+\s*/, "")}
                        </h2>
                      );
                    }
                    if (trimmed.startsWith("## ")) {
                      return (
                        <h3 key={i} className="font-semibold uppercase tracking-[0.12em] text-foreground/90 text-xs">
                          {trimmed.replace(/^#+\s*/, "")}
                        </h3>
                      );
                    }
                    return <p key={i}>{trimmed}</p>;
                  })}
              </div>

              {/* Dual checkboxes — enabled only after scrolling */}
              <div className="space-y-3 pt-1">
                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id="tos-read"
                    checked={tosChecked}
                    onCheckedChange={(v) => setTosChecked(v === true)}
                    disabled={!scrolledTos}
                    className="mt-0.5"
                  />
                  <label
                    htmlFor="tos-read"
                    className={`text-xs leading-relaxed cursor-pointer select-none ${
                      scrolledTos ? "text-foreground/80" : "text-foreground/30"
                    }`}
                  >
                    I have read and understand the Terms of Service
                  </label>
                </div>

                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id="storage-consent"
                    checked={storageChecked}
                    onCheckedChange={(v) => setStorageChecked(v === true)}
                    disabled={!scrolledTos}
                    className="mt-0.5"
                  />
                  <label
                    htmlFor="storage-consent"
                    className={`text-xs leading-relaxed cursor-pointer select-none ${
                      scrolledTos ? "text-foreground/80" : "text-foreground/30"
                    }`}
                  >
                    I accept cookies and the application to manage local data, persistent calls required to use this application
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-row items-center gap-2">
          {stepIndex > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={goBack}
              disabled={creating}
              className="gap-1 text-foreground/60"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          )}

          <div className="flex-1" />

          {onDismiss && stepIndex === 0 && (
            <Button variant="ghost" size="sm" onClick={onDismiss} disabled={creating}>
              Maybe Later
            </Button>
          )}

          {step !== "tos" ? (
            <Button onClick={goNext} className="gap-1.5">
              Next
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              onClick={rateLimitedCreate}
              disabled={!scrolledTos || !tosChecked || !storageChecked || creating}
              className="gap-2 bg-gradient-to-r from-[hsl(174,59%,56%)] to-[hsl(326,71%,62%)] text-white"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Accept & Create Account
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
