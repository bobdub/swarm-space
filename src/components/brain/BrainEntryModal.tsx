import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AvatarSelector } from "@/components/virtualHub/AvatarSelector";
import { DeviceCheckStep } from "@/components/virtualHub/DeviceCheckStep";
import {
  loadHubPrefs,
  saveHubPrefs,
  DEFAULT_AVATAR_ID,
} from "@/lib/virtualHub/avatars";

interface BrainEntryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

type Step = "avatar" | "devices";

/**
 * Pre-spawn gate for the Brain. Mirrors VirtualHubModal: pick an avatar,
 * test mic + speakers, then enter. Persists to the shared
 * `swarm-virtual-hub-prefs` key so the choice carries across virtual hubs.
 */
export function BrainEntryModal({ open, onOpenChange, onConfirm }: BrainEntryModalProps) {
  const [step, setStep] = useState<Step>("avatar");
  const [avatarId, setAvatarId] = useState<string>(DEFAULT_AVATAR_ID);
  const [audioInputId, setAudioInputId] = useState<string | undefined>();
  const [audioOutputId, setAudioOutputId] = useState<string | undefined>();
  const [permissionGranted, setPermissionGranted] = useState(false);

  useEffect(() => {
    if (open) {
      const prefs = loadHubPrefs();
      setAvatarId(prefs.avatarId);
      setAudioInputId(prefs.audioInputId);
      setAudioOutputId(prefs.audioOutputId);
      setStep("avatar");
      setPermissionGranted(false);
    }
  }, [open]);

  const handleEnter = () => {
    saveHubPrefs({
      avatarId,
      audioInputId,
      audioOutputId,
      infinityVoice: loadHubPrefs().infinityVoice ?? true,
    });
    // Brain-specific completion flag — separate from virtual hub prefs so
    // returning Hub visitors still see the Brain mic/avatar gate at least once.
    try {
      localStorage.setItem(
        "brain-entry-complete",
        JSON.stringify({ avatarId, audioInputId, hasMic: true, ts: Date.now() }),
      );
    } catch {
      /* ignore quota / private-mode errors */
    }
    onOpenChange(false);
    onConfirm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "avatar" ? "Choose your form" : "Test your voice"}
          </DialogTitle>
          <DialogDescription>
            {step === "avatar"
              ? "Pick how you'll appear inside the Brain. Heavier avatars move with more weight."
              : "Verify your microphone — voice chat with everyone in the Brain runs over P2P."}
          </DialogDescription>
        </DialogHeader>

        {step === "avatar" ? (
          <AvatarSelector selectedId={avatarId} onSelect={setAvatarId} />
        ) : (
          <DeviceCheckStep
            audioInputId={audioInputId}
            audioOutputId={audioOutputId}
            onChange={(p) => {
              setAudioInputId(p.audioInputId);
              setAudioOutputId(p.audioOutputId);
            }}
            onPermissionGranted={setPermissionGranted}
          />
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          {step === "devices" && (
            <Button type="button" variant="outline" onClick={() => setStep("avatar")}>
              Back
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {step === "avatar" ? (
            <Button type="button" onClick={() => setStep("devices")}>
              Continue
            </Button>
          ) : (
            <Button type="button" onClick={handleEnter} disabled={!permissionGranted}>
              Enter the Brain
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}