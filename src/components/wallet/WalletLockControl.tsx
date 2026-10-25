/** Lock / unlock the signing wallet. Unlocked stays unlocked across visits until the user locks it. */
import { useCallback, useEffect, useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  hasPassedWalletLockQuiz, hasSeparateWalletPassphrase, isWalletExplicitlyLocked, isWalletUnlocked,
  lockWallet, markWalletLockQuizPassed, unlockWallet, WALLET_LOCK_EVENT,
} from "@/lib/auth";

const QUIZ = [
  {
    q: "Who can help?",
    prompt: "If you lose your wallet lock passphrase, who can help you recover it?",
    options: [
      "SWARM devs",
      "No one can help, my only course of action is to create a new account where I know the wallet lock passphrase.",
    ],
    answer: 1,
  },
  {
    q: "SWARM Space devs may ask for this passphrase to troubleshoot.",
    prompt: "Is that true?",
    options: [
      "True - Yes, it's safe to share this with SWARM Space devs.",
      "False - I should never share this with anyone.",
    ],
    answer: 1,
  },
];

type LockStep = "quiz" | "choose";

export function WalletLockControl() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [separate, setSeparate] = useState(false);
  const [lockStep, setLockStep] = useState<LockStep | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([null, null]);
  const [quizError, setQuizError] = useState(false);
  const [mode, setMode] = useState<"account" | "separate">("account");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void isWalletUnlocked().then(setUnlocked);
    void hasSeparateWalletPassphrase().then(setSeparate);
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(WALLET_LOCK_EVENT, refresh);
    return () => window.removeEventListener(WALLET_LOCK_EVENT, refresh);
  }, [refresh]);

  const startLock = () => {
    setAnswers([null, null]); setQuizError(false); setMode("account"); setNewPass(""); setNewPass2("");
    setLockStep(hasPassedWalletLockQuiz() ? "choose" : "quiz");
  };

  const submitQuiz = () => {
    if (answers.every((a, i) => a === QUIZ[i].answer)) {
      markWalletLockQuizPassed(); setQuizError(false); setLockStep("choose");
    } else setQuizError(true);
  };

  const passError = mode === "separate"
    ? newPass.length < 8 ? "Use at least 8 characters." : newPass !== newPass2 ? "Passphrases don't match." : null
    : null;

  const doLock = async () => {
    setBusy(true);
    try {
      await lockWallet(mode === "separate" ? { separatePassphrase: newPass } : {});
      setLockStep(null); setNewPass(""); setNewPass2("");
      toast.success("Wallet locked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not lock the wallet.");
    } finally { setBusy(false); refresh(); }
  };

  const doUnlock = async () => {
    setBusy(true);
    try {
      await unlockWallet(pass);
      setPass(""); setUnlockOpen(false);
      toast.success("Wallet unlocked");
    } catch {
      toast.error("Wrong passphrase — wallet stays locked.");
    } finally { setBusy(false); refresh(); }
  };

  if (unlocked === null) return null;
  const explicit = isWalletExplicitlyLocked();

  return (
    <>
      {unlocked ? (
        <Button type="button" size="sm" variant="outline" onClick={startLock}>
          <Lock className="mr-1 h-3 w-3" />Lock wallet
        </Button>
      ) : (
        <Button type="button" size="sm" onClick={() => setUnlockOpen(true)}>
          <Unlock className="mr-1 h-3 w-3" />{explicit ? "Unlock wallet" : "Set up signing on this device"}
        </Button>
      )}

      <Dialog open={lockStep !== null} onOpenChange={(v) => !busy && !v && setLockStep(null)}>
        <DialogContent className="max-w-md">
          {lockStep === "quiz" ? (
            <>
              <DialogHeader>
                <DialogTitle>Before you set a wallet lock</DialogTitle>
                <DialogDescription>Answer both questions correctly to continue.</DialogDescription>
              </DialogHeader>
              <div role="form" className="space-y-4">
                {QUIZ.map((item, qi) => (
                  <div key={qi} className="space-y-2">
                    <p className="text-sm font-medium">{item.q}</p>
                    <p className="text-xs text-muted-foreground">{item.prompt}</p>
                    {item.options.map((opt, oi) => (
                      <Button key={oi} type="button" variant={answers[qi] === oi ? "default" : "outline"}
                        className="h-auto w-full justify-start whitespace-normal text-left text-xs"
                        onClick={() => setAnswers((a) => a.map((x, i) => (i === qi ? oi : x)))}>
                        {String.fromCharCode(65 + oi)}.) {opt}
                      </Button>
                    ))}
                  </div>
                ))}
                {quizError && <p className="text-xs text-destructive">Not quite — read each question again and try once more.</p>}
              </div>
              <DialogFooter>
                <Button type="button" disabled={answers.some((a) => a === null)} onClick={submitQuiz}>Continue</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Lock your wallet?</DialogTitle>
                <DialogDescription>Choose which passphrase unlocks your wallet again.</DialogDescription>
              </DialogHeader>
              <div role="form" className="space-y-3">
                <Button type="button" variant={mode === "account" ? "default" : "outline"}
                  className="h-auto w-full justify-start whitespace-normal text-left text-xs" onClick={() => setMode("account")}>
                  Use my account passphrase
                </Button>
                <Button type="button" variant={mode === "separate" ? "default" : "outline"}
                  className="h-auto w-full justify-start whitespace-normal text-left text-xs" onClick={() => setMode("separate")}>
                  Set a separate wallet passphrase{separate ? " (replaces your current one)" : ""}
                </Button>
                {mode === "separate" && (
                  <div className="space-y-2">
                    <Label htmlFor="wl-new">Wallet passphrase</Label>
                    <Input id="wl-new" type="password" autoComplete="new-password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
                    <Label htmlFor="wl-new2">Repeat wallet passphrase</Label>
                    <Input id="wl-new2" type="password" autoComplete="new-password" value={newPass2} onChange={(e) => setNewPass2(e.target.value)} />
                    {passError && (newPass || newPass2) && <p className="text-xs text-destructive">{passError}</p>}
                    <p className="text-xs text-muted-foreground">No one can recover this passphrase. Never share it with anyone.</p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setLockStep(null)}>Cancel</Button>
                <Button type="button" disabled={busy || !!passError} onClick={() => void doLock()}>
                  {busy ? "Locking…" : "Lock wallet"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={unlockOpen} onOpenChange={(v) => !busy && setUnlockOpen(v)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Unlock wallet</DialogTitle></DialogHeader>
          <div role="form" className="space-y-2">
            <Label htmlFor="wl-pass">{separate ? "Wallet passphrase" : "Account passphrase"}</Label>
            <Input id="wl-pass" type="password" value={pass} autoComplete="current-password"
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && pass) void doUnlock(); }} />
            {!explicit && <p className="text-xs text-muted-foreground">One time only: this device has not saved your signing key yet (it was signed in before auto-unlock existed). Your passphrase is the only thing that can create it.</p>}
            <p className="text-xs text-muted-foreground">Stays unlocked on this device until you lock it or sign out.</p>
          </div>
          <DialogFooter>
            <Button type="button" disabled={busy || !pass} onClick={() => void doUnlock()}>
              {busy ? "Unlocking…" : "Unlock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
